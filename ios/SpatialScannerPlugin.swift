import ARKit
import AVFoundation
import Capacitor
import SceneKit
import UIKit
import simd

/// Camera-based room-surface capture. This deliberately does not use RoomPlan
/// or require LiDAR; it returns ARKit plane observations, not a complete mesh.
@objc(SpatialScannerPlugin)
public class SpatialScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpatialScannerPlugin"
    public let jsName = "SpatialScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: .promise),
        CAPPluginMethod(name: "startScan", returnType: .promise)
    ]

    @objc func getCapabilities(_ call: CAPPluginCall) {
        call.resolve([
            "worldTrackingSupported": ARWorldTrackingConfiguration.isSupported,
            "cameraPermission": Self.cameraPermissionStatus(),
            "usesLiDAR": false,
            "usesRoomPlan": false
        ])
    }

    @objc func startScan(_ call: CAPPluginCall) {
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
                        call.reject("The scanner is no longer available.")
                        return
                    }
                    guard granted else {
                        call.reject("Camera access was not granted. Enable Camera access in iOS Settings to scan a room.")
                        return
                    }
                    self.presentScanner(for: call)
                }
            }
        case .denied, .restricted:
            call.reject("Camera access is disabled. Enable it in iOS Settings before scanning.")
        @unknown default:
            call.reject("The camera permission status could not be determined.")
        }
    }

    private func presentScanner(for call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("The Spatial Studio view is not ready to present the scanner.")
                return
            }

            let scanner = SpatialScannerViewController()
            scanner.modalPresentationStyle = .fullScreen
            scanner.onComplete = { result in
                scanner.dismiss(animated: true) {
                    call.resolve(result)
                }
            }
            scanner.onCancel = {
                scanner.dismiss(animated: true) {
                    call.reject("Room scan was cancelled.")
                }
            }
            presenter.present(scanner, animated: true)
        }
    }

    private static func cameraPermissionStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return "authorized"
        case .notDetermined: return "not-determined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "unknown"
        }
    }
}

private final class SpatialScannerViewController: UIViewController, ARSCNViewDelegate, ARSessionDelegate {
    var onComplete: (([String: Any]) -> Void)?
    var onCancel: (() -> Void)?

    private let sceneView = ARSCNView(frame: .zero)
    private let statusLabel = UILabel()
    private let guidanceLabel = UILabel()
    private var observedPlanes: [UUID: ARPlaneAnchor] = [:]
    private var hasStarted = false
    private var hasFinished = false
    private var trackingMessage = "Tracking: initializing…"

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
        view.addSubview(sceneView)

        NSLayoutConstraint.activate([
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    private func configureControls() {
        let panel = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterialDark))
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.layer.cornerRadius = 18
        panel.clipsToBounds = true
        view.addSubview(panel)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "Tracking: initializing…"
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        statusLabel.numberOfLines = 0

        guidanceLabel.translatesAutoresizingMaskIntoConstraints = false
        guidanceLabel.text = "Move slowly around the room. Sweep the camera across the floor, then each wall and the corners. Keep the room well lit.\n\nCamera frames stay on this device; this prototype sends no images or video to a server."
        guidanceLabel.textColor = UIColor.white.withAlphaComponent(0.82)
        guidanceLabel.font = .systemFont(ofSize: 12, weight: .regular)
        guidanceLabel.numberOfLines = 0

        let finish = UIButton(type: .system)
        finish.translatesAutoresizingMaskIntoConstraints = false
        finish.setTitle("Finish scan", for: .normal)
        finish.tintColor = .white
        finish.backgroundColor = UIColor.systemGreen
        finish.layer.cornerRadius = 11
        finish.addTarget(self, action: #selector(finishScan), for: .touchUpInside)

        let cancel = UIButton(type: .system)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.setTitle("Cancel", for: .normal)
        cancel.tintColor = .white
        cancel.backgroundColor = UIColor.white.withAlphaComponent(0.12)
        cancel.layer.cornerRadius = 11
        cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)

        panel.contentView.addSubview(statusLabel)
        panel.contentView.addSubview(guidanceLabel)
        panel.contentView.addSubview(finish)
        panel.contentView.addSubview(cancel)

        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            panel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -14),
            panel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -14),

            statusLabel.topAnchor.constraint(equalTo: panel.contentView.topAnchor, constant: 16),
            statusLabel.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor, constant: -16),

            guidanceLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
            guidanceLabel.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            guidanceLabel.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),

            finish.topAnchor.constraint(equalTo: guidanceLabel.bottomAnchor, constant: 14),
            finish.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            finish.heightAnchor.constraint(equalToConstant: 46),
            finish.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor, constant: -14),

            cancel.centerYAnchor.constraint(equalTo: finish.centerYAnchor),
            cancel.leadingAnchor.constraint(equalTo: finish.trailingAnchor, constant: 10),
            cancel.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),
            cancel.widthAnchor.constraint(equalTo: finish.widthAnchor),
            cancel.heightAnchor.constraint(equalTo: finish.heightAnchor)
        ])
    }

    private func startSession() {
        guard !hasStarted else { return }
        guard ARWorldTrackingConfiguration.isSupported else {
            trackingMessage = "ARKit world tracking is unavailable on this device."
            updateStatus()
            return
        }

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal, .vertical]
        configuration.worldAlignment = .gravity
        sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        hasStarted = true
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        switch camera.trackingState {
        case .normal:
            trackingMessage = "Tracking: normal"
        case .notAvailable:
            trackingMessage = "Tracking: unavailable. Hold the phone steady and wait."
        case .limited(let reason):
            switch reason {
            case .initializing:
                trackingMessage = "Tracking: initializing. Move the phone slowly."
            case .excessiveMotion:
                trackingMessage = "Tracking limited: slow down your movement."
            case .insufficientFeatures:
                trackingMessage = "Tracking limited: improve lighting and point toward surfaces with visible detail."
            case .relocalizing:
                trackingMessage = "Tracking limited: hold steady while ARKit re-establishes its position."
            @unknown default:
                trackingMessage = "Tracking is limited. Hold steady and move slowly."
            }
        }
        updateStatus()
    }

    func sessionWasInterrupted(_ session: ARSession) {
        trackingMessage = "Tracking paused because the camera session was interrupted."
        updateStatus()
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        trackingMessage = "Tracking restarting…"
        hasStarted = false
        startSession()
        updateStatus()
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        trackingMessage = "AR session failed: \(error.localizedDescription)"
        updateStatus()
    }

    func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor else { return }
        observedPlanes[plane.identifier] = plane
        addPlaneVisualization(for: plane, to: node)
        updateStatus()
    }

    func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor else { return }
        observedPlanes[plane.identifier] = plane
        node.childNodes.forEach { $0.removeFromParentNode() }
        addPlaneVisualization(for: plane, to: node)
        updateStatus()
    }

    func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor else { return }
        observedPlanes.removeValue(forKey: plane.identifier)
        updateStatus()
    }

    private func addPlaneVisualization(for plane: ARPlaneAnchor, to node: SCNNode) {
        let isHorizontal = plane.alignment == .horizontal
        let width = CGFloat(plane.extent.x)
        let depthOrHeight = CGFloat(isHorizontal ? plane.extent.z : plane.extent.y)
        let geometry = SCNPlane(width: max(width, 0.02), height: max(depthOrHeight, 0.02))
        geometry.firstMaterial?.diffuse.contents = UIColor.systemTeal.withAlphaComponent(0.30)
        geometry.firstMaterial?.isDoubleSided = true

        let planeNode = SCNNode(geometry: geometry)
        if isHorizontal {
            planeNode.eulerAngles.x = -.pi / 2
        }
        planeNode.position = SCNVector3(plane.center.x, plane.center.y, plane.center.z)
        node.addChildNode(planeNode)
    }

    private func updateStatus() {
        let floors = observedPlanes.values.filter { $0.alignment == .horizontal }.count
        let walls = observedPlanes.values.filter { $0.alignment == .vertical }.count
        DispatchQueue.main.async {
            self.statusLabel.text = "\(self.trackingMessage)\nHorizontal surfaces: \(floors) · Vertical surfaces: \(walls)"
        }
    }

    private func serializedPlanes() -> [[String: Any]] {
        observedPlanes.values.sorted { $0.identifier.uuidString < $1.identifier.uuidString }.map { plane in
            let isHorizontal = plane.alignment == .horizontal
            let width = Double(plane.extent.x)
            let depth = Double(plane.extent.z)
            let height = Double(plane.extent.y)
            let area = width * (isHorizontal ? depth : height)
            let matrix = plane.transform
            let center = plane.center
            let centerWorld = simd_mul(matrix, SIMD4<Float>(center.x, center.y, center.z, 1))
            let boundaryWorld: [[Double]] = plane.geometry.boundaryVertices.map { vertex in
                let world = simd_mul(matrix, SIMD4<Float>(vertex.x, vertex.y, vertex.z, 1))
                return [Double(world.x), Double(world.y), Double(world.z)]
            }
            let transform: [Double] = [
                Double(matrix.columns.0.x), Double(matrix.columns.0.y), Double(matrix.columns.0.z), Double(matrix.columns.0.w),
                Double(matrix.columns.1.x), Double(matrix.columns.1.y), Double(matrix.columns.1.z), Double(matrix.columns.1.w),
                Double(matrix.columns.2.x), Double(matrix.columns.2.y), Double(matrix.columns.2.z), Double(matrix.columns.2.w),
                Double(matrix.columns.3.x), Double(matrix.columns.3.y), Double(matrix.columns.3.z), Double(matrix.columns.3.w)
            ]

            return [
                "id": plane.identifier.uuidString,
                "alignment": isHorizontal ? "horizontal" : "vertical",
                "width": width,
                "length": isHorizontal ? depth : 0,
                "height": isHorizontal ? 0 : height,
                "area": area,
                "center": [
                    "x": Double(center.x),
                    "y": Double(center.y),
                    "z": Double(center.z)
                ],
                "centerWorld": [
                    "x": Double(centerWorld.x),
                    "y": Double(centerWorld.y),
                    "z": Double(centerWorld.z)
                ],
                "transform": transform,
                "boundaryWorld": boundaryWorld,
                "measurementNote": "ARKit plane extent; approximate and subject to change as tracking continues."
            ]
        }
    }

    @objc private func finishScan() {
        guard !hasFinished else { return }
        hasFinished = true
        sceneView.session.pause()
        let planes = serializedPlanes()
        let floorCount = planes.filter { ($0["alignment"] as? String) == "horizontal" }.count
        let wallCount = planes.filter { ($0["alignment"] as? String) == "vertical" }.count
        onComplete?([
            "planes": planes,
            "summary": [
                "horizontalSurfaceCount": floorCount,
                "verticalSurfaceCount": wallCount,
                "trackingStatus": trackingMessage,
                "measurementNote": "Plane detection identifies candidate flat surfaces. Confirm the floor and each wall; missing surfaces are not reconstructed automatically."
            ]
        ])
    }

    @objc private func cancelScan() {
        guard !hasFinished else { return }
        hasFinished = true
        sceneView.session.pause()
        onCancel?()
    }
}
