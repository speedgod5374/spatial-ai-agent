import ARKit
import Capacitor
import SceneKit
import UIKit

/// Camera-based ARKit plane scanner for devices that support world tracking.
/// This is intentionally not RoomPlan and does not promise a complete room mesh.
@objc(SpatialScannerPlugin)
public class SpatialScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpatialScannerPlugin"
    public let jsName = "SpatialScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startScan", returnType: .promise)
    ]

    @objc func startScan(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.reject("AR world tracking is not supported on this device.")
            return
        }

        DispatchQueue.main.async {
            let scanner = SpatialScannerViewController()
            scanner.onComplete = { [weak self] planes in
                self?.bridge?.viewController?.dismiss(animated: true) {
                    call.resolve(["planes": planes, "summary": Self.makeSummary(planes)])
                }
            }
            scanner.onCancel = { [weak self] in
                self?.bridge?.viewController?.dismiss(animated: true) {
                    call.reject("Room scan was cancelled.")
                }
            }
            self.bridge?.viewController?.present(scanner, animated: true)
        }
    }

    private static func makeSummary(_ planes: [[String: Any]]) -> [String: Any] {
        let floors = planes.filter { ($0["alignment"] as? String) == "horizontal" }
            .sorted { (($0["area"] as? Double) ?? 0) > (($1["area"] as? Double) ?? 0) }
        let walls = planes.filter { ($0["alignment"] as? String) == "vertical" }
        let floor = floors.first
        let wallHeight = walls.compactMap { $0["height"] as? Double }.max() ?? 0

        return [
            "floorWidth": floor?["width"] ?? 0,
            "floorLength": floor?["length"] ?? 0,
            "estimatedWallHeight": wallHeight,
            "floorDetected": floor != nil,
            "wallCount": walls.count,
            "measurementNote": "Plane extents are estimates. Confirm room boundaries and dimensions before relying on this model."
        ]
    }
}

private final class SpatialScannerViewController: UIViewController, ARSCNViewDelegate {
    var onComplete: (([[String: Any]]) -> Void)?
    var onCancel: (() -> Void)?

    private let sceneView = ARSCNView(frame: .zero)
    private let statusLabel = UILabel()
    private var observedPlanes: [UUID: ARPlaneAnchor] = [:]
    private var hasStarted = false

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
        panel.layer.cornerRadius = 16
        panel.clipsToBounds = true
        view.addSubview(panel)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "Move slowly and point toward the floor and walls."
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.numberOfLines = 0
        panel.contentView.addSubview(statusLabel)

        let finish = UIButton(type: .system)
        finish.translatesAutoresizingMaskIntoConstraints = false
        finish.setTitle("Finish scan", for: .normal)
        finish.tintColor = .white
        finish.backgroundColor = UIColor.systemBlue
        finish.layer.cornerRadius = 11
        finish.addTarget(self, action: #selector(finishScan), for: .touchUpInside)

        let cancel = UIButton(type: .system)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.setTitle("Cancel", for: .normal)
        cancel.tintColor = .white
        cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
        panel.contentView.addSubview(finish)
        panel.contentView.addSubview(cancel)

        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            panel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            panel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            statusLabel.topAnchor.constraint(equalTo: panel.contentView.topAnchor, constant: 14),
            statusLabel.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor, constant: 14),
            statusLabel.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor, constant: -14),
            finish.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 12),
            finish.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            finish.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor, constant: -12),
            cancel.centerYAnchor.constraint(equalTo: finish.centerYAnchor),
            cancel.trailingAnchor.constraint(equalTo: statusLabel.trailingAnchor),
            cancel.leadingAnchor.constraint(greaterThanOrEqualTo: finish.trailingAnchor, constant: 16)
        ])
    }

    private func startSession() {
        guard !hasStarted else { return }
        guard ARWorldTrackingConfiguration.isSupported else {
            statusLabel.text = "AR world tracking is unavailable on this device."
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

    private func addPlaneVisualization(for plane: ARPlaneAnchor, to node: SCNNode) {
        let isHorizontal = plane.alignment == .horizontal
        let width = CGFloat(plane.extent.x)
        let height = CGFloat(isHorizontal ? plane.extent.z : plane.extent.y)
        let geometry = SCNPlane(width: max(width, 0.02), height: max(height, 0.02))
        geometry.firstMaterial?.diffuse.contents = UIColor.systemTeal.withAlphaComponent(0.28)
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
            self.statusLabel.text = "Tracking surfaces…\nFloor surfaces: \(floors) · Wall surfaces: \(walls)\nMove slowly and revisit areas that are not detected."
        }
    }

    private func serializedPlanes() -> [[String: Any]] {
        observedPlanes.values.map { plane in
            let horizontal = plane.alignment == .horizontal
            let width = Double(plane.extent.x)
            let secondary = Double(horizontal ? plane.extent.z : plane.extent.y)
            let transform = plane.transform
            return [
                "id": plane.identifier.uuidString,
                "alignment": horizontal ? "horizontal" : "vertical",
                "width": width,
                "length": horizontal ? secondary : 0,
                "height": horizontal ? 0 : secondary,
                "area": width * secondary,
                "center": [
                    "x": Double(transform.columns.3.x),
                    "y": Double(transform.columns.3.y),
                    "z": Double(transform.columns.3.z)
                ]
            ]
        }
    }

    @objc private func finishScan() {
        sceneView.session.pause()
        onComplete?(serializedPlanes())
    }

    @objc private func cancelScan() {
        sceneView.session.pause()
        onCancel?()
    }
}
