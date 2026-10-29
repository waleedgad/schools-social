// Copies the photos and videos off a plugged-in iPhone or iPad with Apple's
// Image Capture, without exporting them first. The app builds this once on
// the Mac (xcrun swiftc -O iphone-import.swift -o iphone-import) or ships it
// built.
//
//   iphone-import download <folder> <seen.txt>
//
// Photos whose "name|size|seconds" is listed in seen.txt were imported
// before and are left on the phone. Progress lines look like "12/340".
import Foundation
import ImageCaptureCore

final class Importer: NSObject, ICDeviceBrowserDelegate, ICCameraDeviceDelegate, ICCameraDeviceDownloadDelegate {
  let browser = ICDeviceBrowser()
  var camera: ICCameraDevice?
  let dest: URL
  let seen: Set<String>
  var queue: [ICCameraFile] = []
  var total = 0
  var done = 0

  init(dest: URL, seen: Set<String>) {
    self.dest = dest
    self.seen = seen
  }

  func start() {
    browser.delegate = self
    let mask = ICDeviceTypeMask.camera.rawValue | ICDeviceLocationTypeMask.local.rawValue
    browser.browsedDeviceTypeMask = ICDeviceTypeMask(rawValue: mask) ?? .camera
    browser.start()
    // No phone within 20 seconds: give up.
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      if self.camera == nil {
        fputs("no-device\n", stderr)
        exit(3)
      }
    }
  }

  func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
    guard camera == nil, let cam = device as? ICCameraDevice else { return }
    camera = cam
    cam.delegate = self
    cam.requestOpenSession()
  }

  func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {}

  func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
    if let error = error {
      fputs("open: \(error.localizedDescription)\n", stderr)
      exit(5)
    }
  }

  func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {
    let files = (device.mediaFiles ?? []).compactMap { $0 as? ICCameraFile }
    queue = files.filter { f in
      let secs = Int((f.creationDate ?? Date()).timeIntervalSince1970)
      return !seen.contains("\((f.name ?? "").lowercased())|\(f.fileSize)|\(secs)")
    }
    total = queue.count
    print("0/\(total)")
    fflush(stdout)
    next()
  }

  func next() {
    guard let cam = camera else { return }
    if queue.isEmpty {
      print("done \(done)")
      fflush(stdout)
      cam.requestCloseSession()
      exit(0)
    }
    let f = queue.removeFirst()
    cam.requestDownloadFile(
      f,
      options: [.downloadsDirectoryURL: dest, .overwrite: false],
      downloadDelegate: self,
      didDownloadSelector: #selector(didDownloadFile(_:error:options:contextInfo:)),
      contextInfo: nil
    )
  }

  @objc func didDownloadFile(_ file: ICCameraFile, error: Error?, options: [String: Any], contextInfo: UnsafeMutableRawPointer?) {
    if let error = error { fputs("skip \(file.name ?? ""): \(error.localizedDescription)\n", stderr) }
    done += 1
    print("\(done)/\(total)")
    fflush(stdout)
    next()
  }

  // The phone is locked or hasn't trusted this Mac yet.
  func cameraDeviceDidEnableAccessRestriction(_ device: ICDevice) {
    fputs("locked\n", stderr)
  }
  func cameraDeviceDidRemoveAccessRestriction(_ device: ICDevice) {}
  func didRemove(_ device: ICDevice) {
    fputs("unplugged\n", stderr)
    exit(4)
  }
  func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {}
  func cameraDevice(_ camera: ICCameraDevice, didAdd items: [ICCameraItem]) {}
  func cameraDevice(_ camera: ICCameraDevice, didRemove items: [ICCameraItem]) {}
  func cameraDevice(_ camera: ICCameraDevice, didReceiveThumbnail thumbnail: CGImage?, for item: ICCameraItem, error: Error?) {}
  func cameraDevice(_ camera: ICCameraDevice, didReceiveMetadata metadata: [AnyHashable: Any]?, for item: ICCameraItem, error: Error?) {}
  func cameraDevice(_ camera: ICCameraDevice, didRenameItems items: [ICCameraItem]) {}
  func cameraDeviceDidChangeCapability(_ camera: ICCameraDevice) {}
  func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {}
}

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "download" else {
  fputs("usage: iphone-import download <folder> [seen.txt]\n", stderr)
  exit(2)
}
let seen = args.count > 3 ? Set(((try? String(contentsOfFile: args[3], encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)) : []
let importer = Importer(dest: URL(fileURLWithPath: args[2], isDirectory: true), seen: seen)
importer.start()
RunLoop.main.run()
