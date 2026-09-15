// frames.swift — pull still frames out of a video.
//
// Only needed when yt-dlp hands back a slideshow as an mp4 instead of the separate
// slide images. Samples a frame every N seconds; the glue script then OCRs each one
// and throws away consecutive frames whose text is identical, which leaves one frame
// per slide without having to guess where the cuts are.
//
//   swift frames.swift video.mp4 outdir [interval]
//
// Uses AVFoundation, which ships with macOS, so there is no ffmpeg to install.

import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: frames <video> <outdir> [interval seconds]\n".data(using: .utf8)!)
    exit(2)
}

let videoPath = args[0]
let outDir = args[1]
let interval = args.count > 2 ? Double(args[2]) ?? 0.5 : 0.5

try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let asset = AVURLAsset(url: URL(fileURLWithPath: videoPath))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let semaphore = DispatchSemaphore(value: 0)
var duration: Double = 0
var loadError: Error?

Task {
    do {
        duration = try await CMTimeGetSeconds(asset.load(.duration))
    } catch {
        loadError = error
    }
    semaphore.signal()
}
semaphore.wait()

if let loadError {
    FileHandle.standardError.write("could not read video: \(loadError)\n".data(using: .utf8)!)
    exit(1)
}

var written = 0
var timestamp = 0.0
var index = 1

while timestamp < duration {
    let time = CMTime(seconds: timestamp, preferredTimescale: 600)
    do {
        let cgImage = try generator.copyCGImage(at: time, actualTime: nil)
        let name = String(format: "frame-%03d.png", index)
        let url = URL(fileURLWithPath: outDir).appendingPathComponent(name)
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            FileHandle.standardError.write("could not create \(name)\n".data(using: .utf8)!)
            exit(1)
        }
        CGImageDestinationAddImage(dest, cgImage, nil)
        CGImageDestinationFinalize(dest)
        written += 1
    } catch {
        // A frame that will not decode is not worth stopping for.
    }
    timestamp += interval
    index += 1
}

print("wrote \(written) frames from \(String(format: "%.1f", duration))s")
