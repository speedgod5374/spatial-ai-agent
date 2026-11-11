import ARKit
import AVFoundation
import Capacitor
import CoreImage
import SceneKit
import UIKit

/// Local Capacitor bridge for camera-based ARKit plane detection.
/// This intentionally does not use RoomPlan, LiDAR, or scene reconstruction.
@objc(SpatialScannerPlugin)
public class SpatialScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpatialScannerPlugin"
    public let jsName = "SpatialScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanRoom", returnType: CAPPluginReturnPromise)
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve([
            "supported": ARWorldTrackingConfiguration.isSupported
        ])
    }

    @objc func scanRoom(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.reject("ARKit world tracking is not supported on this device.")
            return
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentScanner(for: call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else {
                        call.reject("Spatial Studio could not open the scanner.")
                        return
                    }
                    if granted {
                        self.presentScanner(for: call)
                    } else {
                        call.reject("Camera access was denied. Enable camera access for Spatial Studio in Settings.")
                    }
                }
            }
        case .denied, .restricted:
            call.reject("Camera access is unavailable. Enable camera access for Spatial Studio in Settings.")
        @unknown default:
            call.reject("The camera permission state could not be determined.")
        }
    }

    private func presentScanner(for call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("The Spatial Studio view controller is unavailable.")
                return
            }

            let scanner = SpatialScannerViewController()
            scanner.modalPresentationStyle = .fullScreen
            scanner.onComplete = { [weak scanner] result in
                scanner?.dismiss(animated: true) {
                    call.resolve(result)
                }
            }
            scanner.onCancel = { [weak scanner] in
                scanner?.dismiss(animated: true) {
                    call.reject("The room scan was cancelled.", "SCAN_CANCELLED")
                }
            }
            scanner.onFailure = { [weak scanner] message in
                scanner?.dismiss(animated: true) {
                    call.reject(message, "AR_SESSION_FAILED")
                }
            }
            presenter.present(scanner, animated: true)
        }
    }
}

private final class SpatialScannerViewController: UIViewController, ARSCNViewDelegate, ARSessionDelegate {
    var onComplete: (([String: Any]) -> Void)?
    var onCancel: (() -> Void)?
    var onFailure: ((String) -> Void)?

    private let sceneView = ARSCNView(frame: .zero)
    private let statusLabel = UILabel()
    private let countLabel = UILabel()
    private let captureLabel = UILabel()
    private let imageContext = CIContext()
    private let frameLock = NSLock()
    private var capturedFrames: [[String: Any]] = []
    private var lastCapturedTransform: simd_float4x4?
    private var lastCaptureTimestamp: TimeInterval = 0
    private let maximumCapturedFrames = 32
    private let minimumCaptureInterval: TimeInterval = 0.65
    private var observedPlanes: [UUID: ARPlaneAnchor] = [:]
    private let planesLock = NSLock()
    private var hasStarted = false
    private var hasFinished = false
    private var trackingDescription = "Tracking: initializing"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureScene()
        configureControls()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startSession()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
    }

    private func configureScene() {
        sceneView.translatesAutoresizingMaskIntoConstraints = false
        sceneView.delegate = self
        sceneView.session.delegate = self
        sceneView.session.delegateQueue = DispatchQueue(label: "com.spatialstudio.room-capture")
        sceneView.automaticallyUpdatesLighting = true
        sceneView.antialiasingMode = .multisampling4X
        view.addSubview(sceneView)

        NSLayoutConstraint.activate([
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    private func configureControls() {
        let topPanel = makePanel()
        let bottomPanel = makePanel()
        view.addSubview(topPanel)
        view.addSubview(bottomPanel)

        let titleLabel = UILabel()
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "Capture the room from all sides"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)

        let privacyLabel = UILabel()
        privacyLabel.translatesAutoresizingMaskIntoConstraints = false
        privacyLabel.text = "Selected still frames stay on this device. They are not uploaded automatically."
        privacyLabel.textColor = UIColor.white.withAlphaComponent(0.78)
        privacyLabel.font = .systemFont(ofSize: 12, weight: .regular)
        privacyLabel.numberOfLines = 0

        let guidanceLabel = UILabel()
        guidanceLabel.translatesAutoresizingMaskIntoConstraints = false
        guidanceLabel.text = "Start near the doorway, then slowly walk around the room. Sweep across each wall, include the floor and ceiling, and revisit areas from another angle."
        guidanceLabel.textColor = UIColor.white.withAlphaComponent(0.88)
        guidanceLabel.font = .systemFont(ofSize: 13, weight: .medium)
        guidanceLabel.numberOfLines = 0

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = trackingDescription
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        statusLabel.numberOfLines = 0

        countLabel.translatesAutoresizingMaskIntoConstraints = false
        countLabel.text = "Plane hints: 0 horizontal · 0 vertical"
        countLabel.textColor = UIColor.white.withAlphaComponent(0.76)
        countLabel.font = .systemFont(ofSize: 12, weight: .regular)

        captureLabel.translatesAutoresizingMaskIntoConstraints = false
        captureLabel.text = "Captured views: 0 / 32 · Move slowly to collect overlapping views."
        captureLabel.textColor = UIColor(red: 0.30, green: 0.96, blue: 0.88, alpha: 1)
        captureLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        captureLabel.numberOfLines = 0

        let finishButton = makeButton(title: "Finish scan", background: .systemGreen)
        finishButton.addTarget(self, action: #selector(finishScan), for: .touchUpInside)

        let cancelButton = makeButton(title: "Cancel", background: UIColor.white.withAlphaComponent(0.16))
        cancelButton.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)

        topPanel.addSubview(titleLabel)
        topPanel.addSubview(guidanceLabel)
        topPanel.addSubview(privacyLabel)
        bottomPanel.addSubview(statusLabel)
        bottomPanel.addSubview(countLabel)
        bottomPanel.addSubview(captureLabel)
        bottomPanel.addSubview(finishButton)
        bottomPanel.addSubview(cancelButton)

        NSLayoutConstraint.activate([
            topPanel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            topPanel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            topPanel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),

            titleLabel.topAnchor.constraint(equalTo: topPanel.topAnchor, constant: 14),
            titleLabel.leadingAnchor.constraint(equalTo: topPanel.leadingAnchor, constant: 14),
            titleLabel.trailingAnchor.constraint(equalTo: topPanel.trailingAnchor, constant: -14),

            guidanceLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
            guidanceLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            guidanceLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),

            privacyLabel.topAnchor.constraint(equalTo: guidanceLabel.bottomAnchor, constant: 8),
            privacyLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            privacyLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
            privacyLabel.bottomAnchor.constraint(equalTo: topPanel.bottomAnchor, constant: -14),

            bottomPanel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            bottomPanel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            bottomPanel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -14),

            statusLabel.topAnchor.constraint(equalTo: bottomPanel.topAnchor, constant: 14),
            statusLabel.leadingAnchor.constraint(equalTo: bottomPanel.leadingAnchor, constant: 14),
            statusLabel.trailingAnchor.constraint(equalTo: bottomPanel.trailingAnchor, constant: -14),

            countLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
            countLabel.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            countLabel.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),

            captureLabel.topAnchor.constraint(equalTo: countLabel.bottomAnchor, constant: 7),
            captureLabel.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            captureLabel.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),

            finishButton.topAnchor.constraint(equalTo: captureLabel.bottomAnchor, constant: 12),
            finishButton.leadingAnchor.constraint(equalTo: countLabel.leadingAnchor),
            finishButton.bottomAnchor.constraint(equalTo: bottomPanel.bottomAnchor, constant: -12),
            finishButton.heightAnchor.constraint(equalToConstant: 44),

            cancelButton.centerYAnchor.constraint(equalTo: finishButton.centerYAnchor),
            cancelButton.trailingAnchor.constraint(equalTo: countLabel.trailingAnchor),
            cancelButton.leadingAnchor.constraint(greaterThanOrEqualTo: finishButton.trailingAnchor, constant: 12),
            cancelButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 92),
            cancelButton.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    private func makePanel() -> UIView {
        let panel = UIView()
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.backgroundColor = UIColor.black.withAlphaComponent(0.68)
        panel.layer.cornerRadius = 16
        panel.layer.masksToBounds = true
        return panel
    }

    private func makeButton(title: String, background: UIColor) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        button.backgroundColor = background
        button.layer.cornerRadius = 11
        button.contentEdgeInsets = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
        return button
    }

    private func startSession() {
        guard !hasStarted else { return }
        guard ARWorldTrackingConfiguration.isSupported else {
            onFailure?("ARKit world tracking is not supported on this device.")
            return
        }

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal, .vertical]
        configuration.worldAlignment = .gravity
        sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        hasStarted = true
    }

    func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor else { return }
        planesLock.lock()
        observedPlanes[plane.identifier] = plane
        planesLock.unlock()
        addPlaneVisualization(for: plane, to: node)
        updateCounts()
    }

    func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor else { return }
        planesLock.lock()
        observedPlanes[plane.identifier] = plane
        planesLock.unlock()
        node.childNodes.filter { $0.name == "detected-plane-overlay" }.forEach { $0.removeFromParentNode() }
        addPlaneVisualization(for: plane, to: node)
        updateCounts()
    }

    private func addPlaneVisualization(for plane: ARPlaneAnchor, to anchorNode: SCNNode) {
        let isHorizontal = plane.alignment == .horizontal
        let width = CGFloat(plane.extent.x)
        let secondaryExtent = isHorizontal ? CGFloat(plane.extent.z) : CGFloat(plane.extent.y)
        let safeWidth = max(width, 0.04)
        let safeHeight = max(secondaryExtent, 0.04)

        // ARPlaneAnchor geometry is expressed in the anchor's local coordinate space.
        // A horizontal patch needs a quarter-turn because SCNPlane is created in XY.
        let overlay = SCNNode()
        overlay.name = "detected-plane-overlay"
        overlay.position = SCNVector3(plane.center.x, plane.center.y, plane.center.z)
        if isHorizontal {
            overlay.eulerAngles.x = -.pi / 2
        }

        let fill = SCNPlane(width: safeWidth, height: safeHeight)
        let fillMaterial = SCNMaterial()
        fillMaterial.lightingModel = .constant
        fillMaterial.diffuse.contents = UIColor(red: 0.0, green: 0.84, blue: 1.0, alpha: 1)
        fillMaterial.emission.contents = UIColor(red: 0.0, green: 0.48, blue: 0.62, alpha: 1)
        fillMaterial.transparency = 0.52
        fillMaterial.isDoubleSided = true
        fillMaterial.readsFromDepthBuffer = false
        fillMaterial.writesToDepthBuffer = false
        fill.materials = [fillMaterial]

        let fillNode = SCNNode(geometry: fill)
        fillNode.name = "detected-plane-fill"
        fillNode.renderingOrder = 20
        overlay.addChildNode(fillNode)

        // Draw a visible perimeter so the detected patch is recognizable against
        // bright floors and walls, even when the translucent fill is subtle.
        let borderMaterial = SCNMaterial()
        borderMaterial.lightingModel = .constant
        borderMaterial.diffuse.contents = UIColor(red: 0.0, green: 0.96, blue: 1.0, alpha: 1)
        borderMaterial.emission.contents = UIColor(red: 0.0, green: 0.72, blue: 0.85, alpha: 1)
        borderMaterial.isDoubleSided = true
        borderMaterial.readsFromDepthBuffer = false
        borderMaterial.writesToDepthBuffer = false

        let thickness: CGFloat = 0.026
        let borderPieces: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (0, safeHeight / 2, safeWidth, thickness),
            (0, -safeHeight / 2, safeWidth, thickness),
            (-safeWidth / 2, 0, thickness, safeHeight),
            (safeWidth / 2, 0, thickness, safeHeight)
        ]
        for (index, piece) in borderPieces.enumerated() {
            let bar = SCNBox(width: piece.2, height: piece.3, length: 0.004, chamferRadius: 0)
            bar.materials = [borderMaterial]
            let barNode = SCNNode(geometry: bar)
            barNode.name = "detected-plane-border-\(index)"
            barNode.position = SCNVector3(piece.0, piece.1, 0.006)
            barNode.renderingOrder = 21
            overlay.addChildNode(barNode)
        }

        // Keep a small camera-facing label attached to the detected patch.
        let label = SCNText(string: isHorizontal ? "HORIZONTAL" : "VERTICAL", extrusionDepth: 0)
        label.font = UIFont.systemFont(ofSize: 8, weight: .bold)
        label.flatness = 0.2
        label.firstMaterial?.lightingModel = .constant
        label.firstMaterial?.diffuse.contents = UIColor.white
        let labelNode = SCNNode(geometry: label)
        labelNode.name = "detected-plane-label"
        labelNode.scale = SCNVector3(0.012, 0.012, 0.012)
        labelNode.position = SCNVector3(-safeWidth / 2, safeHeight / 2 + 0.06, 0.012)
        labelNode.constraints = [SCNBillboardConstraint()]
        labelNode.renderingOrder = 22
        overlay.addChildNode(labelNode)

        anchorNode.addChildNode(overlay)
    }

    private func updateCounts() {
        planesLock.lock()
        let snapshot = Array(observedPlanes.values)
        planesLock.unlock()
        let horizontal = snapshot.filter { $0.alignment == .horizontal }.count
        let vertical = snapshot.filter { $0.alignment == .vertical }.count
        DispatchQueue.main.async {
            self.countLabel.text = "Plane hints: \(horizontal) horizontal · \(vertical) vertical"
        }
    }

    private func updateTrackingDescription(_ description: String) {
        trackingDescription = description
        DispatchQueue.main.async {
            self.statusLabel.text = description
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        captureFrameIfUseful(frame)
    }

    private func captureFrameIfUseful(_ frame: ARFrame) {
        guard !hasFinished else { return }
        guard case .normal = frame.camera.trackingState else { return }

        let transform = frame.camera.transform
        if let previous = lastCapturedTransform {
            let currentPosition = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
            let previousPosition = SIMD3<Float>(previous.columns.3.x, previous.columns.3.y, previous.columns.3.z)
            let travel = simd_distance(currentPosition, previousPosition)
            let currentForward = simd_normalize(SIMD3<Float>(-transform.columns.2.x, -transform.columns.2.y, -transform.columns.2.z))
            let previousForward = simd_normalize(SIMD3<Float>(-previous.columns.2.x, -previous.columns.2.y, -previous.columns.2.z))
            let directionDot = simd_clamp(simd_dot(currentForward, previousForward), -1.0, 1.0)
            let turnAngle = acos(directionDot)
            guard frame.timestamp - lastCaptureTimestamp >= minimumCaptureInterval,
                  travel >= 0.22 || turnAngle >= 0.25 else { return }
        }

        frameLock.lock()
        let currentCount = capturedFrames.count
        frameLock.unlock()
        guard currentCount < maximumCapturedFrames else { return }

        let pixelBuffer = frame.capturedImage
        let sourceWidth = CVPixelBufferGetWidth(pixelBuffer)
        let sourceHeight = CVPixelBufferGetHeight(pixelBuffer)
        let scale = min(CGFloat(1.0), CGFloat(1024.0) / CGFloat(max(sourceWidth, sourceHeight)))
        let outputWidth = max(1, Int((CGFloat(sourceWidth) * scale).rounded(.down)))
        let outputHeight = max(1, Int((CGFloat(sourceHeight) * scale).rounded(.down)))
        let sourceImage = CIImage(cvPixelBuffer: pixelBuffer)
        let resizedImage = sourceImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let imageRect = CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight)
        guard let cgImage = imageContext.createCGImage(resizedImage, from: imageRect),
              let jpegData = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.62) else {
            updateTrackingDescription("Image capture failed · Keep scanning; some views may be skipped.")
            return
        }

        let intrinsics = frame.camera.intrinsics
        let frameIndex = currentCount + 1
        let record: [String: Any] = [
            "id": String(format: "frame-%03d", frameIndex),
            "filename": String(format: "frames/frame-%03d.jpg", frameIndex),
            "imageBase64": jpegData.base64EncodedString(),
            "timestamp": frame.timestamp,
            "cameraTransform": serializedMatrix(transform),
            "intrinsics": [
                [Double(intrinsics.columns.0.x) * Double(scale), 0.0, Double(intrinsics.columns.2.x) * Double(scale)],
                [0.0, Double(intrinsics.columns.1.y) * Double(scale), Double(intrinsics.columns.2.y) * Double(scale)],
                [0.0, 0.0, 1.0]
            ],
            "imageWidth": outputWidth,
            "imageHeight": outputHeight,
            "originalImageWidth": sourceWidth,
            "originalImageHeight": sourceHeight,
            "imageOrientation": "sensor-native",
            "tracking": "normal"
        ]

        frameLock.lock()
        capturedFrames.append(record)
        let newCount = capturedFrames.count
        frameLock.unlock()
        lastCapturedTransform = transform
        lastCaptureTimestamp = frame.timestamp
        DispatchQueue.main.async {
            self.captureLabel.text = newCount >= self.maximumCapturedFrames
                ? "Captured views: \(newCount) / \(self.maximumCapturedFrames) · Good coverage. You can finish the scan."
                : "Captured views: \(newCount) / \(self.maximumCapturedFrames) · Keep moving slowly and overlap each view."
        }
    }

    private func serializedMatrix(_ transform: simd_float4x4) -> [Double] {
        [
            Double(transform.columns.0.x), Double(transform.columns.0.y), Double(transform.columns.0.z), Double(transform.columns.0.w),
            Double(transform.columns.1.x), Double(transform.columns.1.y), Double(transform.columns.1.z), Double(transform.columns.1.w),
            Double(transform.columns.2.x), Double(transform.columns.2.y), Double(transform.columns.2.z), Double(transform.columns.2.w),
            Double(transform.columns.3.x), Double(transform.columns.3.y), Double(transform.columns.3.z), Double(transform.columns.3.w)
        ]
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        switch camera.trackingState {
        case .normal:
            updateTrackingDescription("Tracking ready · Sweep across the room slowly to capture overlapping views.")
        case .notAvailable:
            updateTrackingDescription("Tracking: unavailable · Move to a better lit area and try again.")
        case .limited(let reason):
            let detail: String
            switch reason {
            case .initializing: detail = "initializing"
            case .excessiveMotion: detail = "phone moving too quickly"
            case .insufficientFeatures: detail = "not enough visible detail"
            case .relocalizing: detail = "relocalizing"
            @unknown default: detail = "limited"
            }
            updateTrackingDescription("Tracking: limited · \(detail). Move slowly and point at textured surfaces.")
        }
    }

    func sessionWasInterrupted(_ session: ARSession) {
        updateTrackingDescription("Tracking paused · The camera session was interrupted.")
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        updateTrackingDescription("Tracking restarting…")
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal, .vertical]
        configuration.worldAlignment = .gravity
        session.run(configuration, options: [])
        planesLock.lock()
        observedPlanes.removeAll()
        planesLock.unlock()
        updateCounts()
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        updateTrackingDescription("ARKit error · \(error.localizedDescription)")
    }

    private func serializedPlanes() -> [[String: Any]] {
        planesLock.lock()
        let snapshot = Array(observedPlanes.values)
        planesLock.unlock()
        return snapshot
            .sorted { $0.identifier.uuidString < $1.identifier.uuidString }
            .map { plane in
                let transform = plane.transform
                let extent = plane.extent
                let center = plane.center
                let matrix: [Double] = [
                    Double(transform.columns.0.x), Double(transform.columns.0.y), Double(transform.columns.0.z), Double(transform.columns.0.w),
                    Double(transform.columns.1.x), Double(transform.columns.1.y), Double(transform.columns.1.z), Double(transform.columns.1.w),
                    Double(transform.columns.2.x), Double(transform.columns.2.y), Double(transform.columns.2.z), Double(transform.columns.2.w),
                    Double(transform.columns.3.x), Double(transform.columns.3.y), Double(transform.columns.3.z), Double(transform.columns.3.w)
                ]

                return [
                    "id": plane.identifier.uuidString,
                    "alignment": plane.alignment == .horizontal ? "horizontal" : "vertical",
                    "extent": [
                        "x": Double(extent.x),
                        "y": Double(extent.y),
                        "z": Double(extent.z)
                    ],
                    "center": [
                        "x": Double(center.x),
                        "y": Double(center.y),
                        "z": Double(center.z)
                    ],
                    "transform": matrix,
                    "area": Double(extent.x * (plane.alignment == .horizontal ? extent.z : extent.y))
                ]
            }
    }

    @objc private func finishScan() {
        guard !hasFinished else { return }
        frameLock.lock()
        let frames = capturedFrames
        frameLock.unlock()
        guard frames.count >= 6 else {
            updateTrackingDescription("Capture at least 6 different viewpoints before finishing. Walk around the room and turn slowly.")
            return
        }

        hasFinished = true
        sceneView.session.pause()
        onComplete?([
            "schemaVersion": 2,
            "source": "ARKit guided multi-view camera capture",
            "captureMethod": "ARKit world-tracked keyframes",
            "units": "meters",
            "imageOrientation": "sensor-native",
            "tracking": trackingDescription,
            "frameCount": frames.count,
            "frames": frames,
            "planes": serializedPlanes(),
            "reconstructionStatus": "pending"
        ])
    }

    @objc private func cancelScan() {
        guard !hasFinished else { return }
        hasFinished = true
        sceneView.session.pause()
        onCancel?()
    }
}
