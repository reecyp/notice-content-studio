// ocr.swift — read the text off slideshow images using Apple's Vision framework.
//
// Runs on the machine, offline, no API key, no cost. Nothing to do with SwiftUI:
// this is a command line script, it takes file paths in and prints text out.
//
//   swift ocr.swift slide.png              plain text
//   swift ocr.swift --json a.png b.png     JSON, one record per image
//
// Compiled by setup.sh into bin/ocr, which starts instantly instead of taking
// a second or two to interpret. The glue script uses the compiled one if it is there.

import Foundation
import ImageIO
import Vision

struct OCRLine: Codable {
    let text: String
    let confidence: Float
}

struct OCRResult: Codable {
    let file: String
    let text: String
    let lines: [OCRLine]
    let error: String?
}

// Vision reports each line with a bounding box in a bottom-left origin space where
// both axes run 0 to 1. Sorting top to bottom then left to right puts the lines back
// into reading order, which matters because a tile is a stack of separate text blocks.
private struct Positioned {
    let text: String
    let confidence: Float
    let midY: CGFloat
    let minX: CGFloat
}

func recognise(path: String) -> OCRResult {
    let url = URL(fileURLWithPath: path)

    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        return OCRResult(file: path, text: "", lines: [], error: "could not read image")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]

    do {
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
    } catch {
        return OCRResult(file: path, text: "", lines: [], error: "\(error)")
    }

    let observations = request.results ?? []
    let positioned: [Positioned] = observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return Positioned(
            text: candidate.string,
            confidence: candidate.confidence,
            midY: observation.boundingBox.midY,
            minX: observation.boundingBox.minX
        )
    }

    // Group anything within 1.2% of the same height as one line, so two words that
    // sit side by side do not come back as two separate lines.
    let tolerance: CGFloat = 0.012
    let sorted = positioned.sorted { a, b in
        if abs(a.midY - b.midY) > tolerance { return a.midY > b.midY }
        return a.minX < b.minX
    }

    var lines: [OCRLine] = []
    var buffer: [Positioned] = []

    func flush() {
        guard !buffer.isEmpty else { return }
        let text = buffer.map(\.text).joined(separator: " ")
        let confidence = buffer.map(\.confidence).reduce(0, +) / Float(buffer.count)
        lines.append(OCRLine(text: text, confidence: confidence))
        buffer = []
    }

    for item in sorted {
        if let last = buffer.last, abs(last.midY - item.midY) > tolerance { flush() }
        buffer.append(item)
    }
    flush()

    return OCRResult(
        file: path,
        text: lines.map(\.text).joined(separator: "\n"),
        lines: lines,
        error: nil
    )
}

// MARK: - CLI

var args = Array(CommandLine.arguments.dropFirst())
let asJSON = args.contains("--json")
args.removeAll { $0.hasPrefix("--") }

guard !args.isEmpty else {
    FileHandle.standardError.write("usage: ocr [--json] <image> [image ...]\n".data(using: .utf8)!)
    exit(2)
}

let results = args.map(recognise)

if asJSON {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(results)
    print(String(data: data, encoding: .utf8)!)
} else {
    for result in results {
        if results.count > 1 { print("=== \(result.file)") }
        if let error = result.error {
            FileHandle.standardError.write("error: \(result.file): \(error)\n".data(using: .utf8)!)
            continue
        }
        print(result.text)
    }
}

exit(results.contains { $0.error != nil } ? 1 : 0)
