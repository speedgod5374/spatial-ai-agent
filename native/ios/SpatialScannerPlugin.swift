import ARKit
import AVFoundation
import Capacitor
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
        titleLabel.text = "Scan the room"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)

        let privacyLabel = UILabel()
        privacyLabel.translatesAutoresizingMaskIntoConstraints = false
        privacyLabel.text = "Camera frames stay on this device. This scan uses ARKit plane detection, not LiDAR."
        privacyLabel.textColor = UIColor.white.withAlphaComponent(0.78)
        privacyLabel.font = .systemFont(ofSize: 12, weight: .regular)
        privacyLabel.numberOfLines = 0

        let guidanceLabel = UILabel()
        guidanceLabel.translatesAutoresizingMaskIntoConstraints = false
        guidanceLabel.text = "Move slowly. Look at the floor first, then each wall. Keep the room well lit and revisit surfaces from another angle."
        guidanceLabel.textColor = UIColor.white.withAlphaComponent(0.88)
        guidanceLabel.font = .systemFont(ofSize: 13, weight: .medium)
        guidanceLabel.numberOfLines = 0

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = trackingDescription
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        statusLabel.numberOfLines = 0

        countLabel.translatesAutoresizingMaskIntoConstraints = false
        countLabel.text = "Horizontal candidates: 0 · Vertical candidates: 0"
        countLabel.textColor = UIColor.white.withAlphaComponent(0.82)
        countLabel.font = .systemFont(ofSize: 12, weight: .regular)

        let finishButton = makeButton(title: "Finish scan", background: .systemGreen)
        finishButton.addTarget(self, action: #selector(finishScan), for: .touchUpInside)

        let cancelButton = makeButton(title: "Cancel", background: UIColor.white.withAlphaComponent(0.16))
        cancelButton.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)

        topPanel.addSubview(titleLabel)
        topPanel.addSubview(guidanceLabel)
        topPanel.addSubview(privacyLabel)
        bottomPanel.addSubview(statusLabel)
        bottomPanel.addSubview(countLabel)
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

            finishButton.topAnchor.constraint(equalTo: countLabel.bottomAnchor, constant: 12),
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
        fillMaterial.diffuse.contents = UIColor.systemTeal
        fillMaterial.transparency = 0.28
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
        borderMaterial.diffuse.contents = UIColor(red: 0.15, green: 0.95, blue: 0.82, alpha: 1)
        borderMaterial.isDoubleSided = true
        borderMaterial.readsFromDepthBuffer = false
        borderMaterial.writesToDepthBuffer = false

        let thickness: CGFloat = 0.012
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
        let label = SCNText(string: isHorizontal ? "HORIZONTAL PATCH" : "VERTICAL PATCH", extrusionDepth: 0)
        label.font = UIFont.systemFont(ofSize: 8, weight: .bold)
        label.flatness = 0.2
        label.firstMaterial?.lightingModel = .constant
        label.firstMaterial?.diffuse.contents = UIColor.white
        let labelNode = SCNNode(geometry: label)
        labelNode.name = "detected-plane-label"
        labelNode.scale = SCNVector3(0.008, 0.008, 0.008)
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
            self.countLabel.text = "Horizontal surfaces: \(horizontal) · Vertical surfaces: \(vertical)"
        }
    }

    private func updateTrackingDescription(_ description: String) {
        trackingDescription = description
        DispatchQueue.main.async {
            self.statusLabel.text = description
        }
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        switch camera.trackingState {
        case .normal:
            updateTrackingDescription("Tracking: normal · Keep moving slowly to reveal more surfaces.")
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
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
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
        planesLock.lock()
        let hasDetectedPlanes = !observedPlanes.isEmpty
        planesLock.unlock()
        guard hasDetectedPlanes else {
            updateTrackingDescription("No surfaces detected yet · Scan the floor and walls before finishing.")
            return
        }

        hasFinished = true
        sceneView.session.pause()
        onComplete?([
            "schemaVersion": 1,
            "source": "ARKit world tracking plane detection",
            "units": "meters",
            "tracking": trackingDescription,
            "planes": serializedPlanes()
        ])
    }

    @objc private func cancelScan() {
        guard !hasFinished else { return }
        hasFinished = true
        sceneView.session.pause()
        onCancel?()
    }
}
