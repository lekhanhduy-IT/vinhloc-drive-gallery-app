import Capacitor

// Set this class as the custom class for the CAPBridgeViewController in Main.storyboard.
open class VLBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VLBackgroundUploadPlugin())
    }
}
