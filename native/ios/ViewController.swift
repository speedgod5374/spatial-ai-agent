import Capacitor
import UIKit

/// Register the app-local ARKit plugin with Capacitor.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SpatialScannerPlugin())
    }
}
