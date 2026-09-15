// make-test-tile.swift — draw a fake carousel tile so the OCR can be smoke tested
// without hitting TikTok. Serif text on an off white background, same shape as the
// paper tiles, so the test is representative rather than a clean lab image.
//
//   swift make-test-tile.swift out.png

import AppKit
import Foundation

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "test-tile.png"
let size = NSSize(width: 1080, height: 1080)

let image = NSImage(size: size)
image.lockFocus()

NSColor(calibratedRed: 0.96, green: 0.95, blue: 0.92, alpha: 1).setFill()
NSRect(origin: .zero, size: size).fill()

// A little speckle, so this is not a perfectly clean background.
for _ in 0..<4000 {
    let x = CGFloat.random(in: 0..<size.width)
    let y = CGFloat.random(in: 0..<size.height)
    NSColor(white: CGFloat.random(in: 0.75...0.92), alpha: 0.35).setFill()
    NSRect(x: x, y: y, width: 2, height: 2).fill()
}

let body = """
1. Never make the first offer:

The first number becomes the ceiling everyone argues down from.

Where this comes up:

• A salary question
• Selling something secondhand
• Rent with a housemate

Ask what they had in mind, then wait.
"""

let paragraph = NSMutableParagraphStyle()
paragraph.lineHeightMultiple = 1.15

let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "Times New Roman", size: 52) ?? NSFont.systemFont(ofSize: 52),
    .foregroundColor: NSColor.black,
    .paragraphStyle: paragraph
]

body.draw(in: NSRect(x: 110, y: 120, width: 860, height: 840), withAttributes: attributes)

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("could not encode png\n".data(using: .utf8)!)
    exit(1)
}

try png.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath)")
