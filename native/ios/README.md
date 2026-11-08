# iOS native upload integration (Capacitor 8)

The repository originally had **no iOS Xcode project**. These Swift sources are not automatically compiled by Vite/Vercel.

1. On macOS install the Capacitor iOS dependency matching version 8: `npm install @capacitor/ios@^8.3.4`.
2. Run `npx cap add ios` and `npx cap sync ios`.
3. Copy `native/ios/VLBackgroundUploadPlugin.swift` and `native/ios/VLBridgeViewController.swift` to the generated Xcode **App target** and ensure Target Membership is enabled.
4. Change the Capacitor bridge view controller's **Custom Class** in `ios/App/App/Base.lproj/Main.storyboard` to `VLBridgeViewController`. Do not replace the rest of the app storyboard.
5. In `AppDelegate.swift` call `VLBackgroundUploadCoordinator.shared.restoreBackgroundSession()` from `application(_:didFinishLaunchingWithOptions:)` and implement:
   ```swift
   func application(_ application: UIApplication,
       handleEventsForBackgroundURLSession identifier: String,
       completionHandler: @escaping () -> Void) {
       VLBackgroundUploadCoordinator.shared.handleBackgroundEvents(
           identifier: identifier, completionHandler: completionHandler)
   }
   ```
6. Configure the native app to use an **HTTPS web origin with working /api/owned-files authentication cookies**. On local `capacitor://localhost` builds, configure `VITE_VL_UPLOAD_API_ORIGIN` and ensure the WebView authenticates at that real API origin; merely setting the variable does not create a cross-origin login cookie.
7. Build and test with a **physical iPhone**. Use 10 photos + 2 videos; switch apps and lock screen immediately after selecting files. Check files on Google Drive and `vlUploadedBy` appProperties. Also test 308 partial transfer, network loss, login switching, and iOS force quit.

iOS background uploads use `URLSessionConfiguration.background` and **file-backed** tasks. The OS decides transfer scheduling and may terminate tasks on explicit force-quit. Before the URLSession tasks can be scheduled, selected files must be copied into app-owned storage. If iOS suspends the app before staging completes, the unscheduled files cannot continue autonomously. This cannot be guaranteed away by keeping the app in the app switcher.

The original web/PWA app still uses its existing JS upload code; background upload is a native-app capability.
