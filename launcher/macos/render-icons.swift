import AppKit
import Foundation

let outputDirectory = CommandLine.arguments.dropFirst().first.map { URL(fileURLWithPath: $0, isDirectory: true) }
guard let outputDirectory else {
    fputs("Usage: render-icons.swift ICON_OUTPUT_DIRECTORY\n", stderr)
    exit(2)
}

let iconSizes: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

for iconName in ["RealmForge", "RealmForgeStop"] {
    let source = outputDirectory.appendingPathComponent("\(iconName).svg")
    let iconSet = outputDirectory.appendingPathComponent("\(iconName).iconset", isDirectory: true)
    guard let image = NSImage(contentsOf: source) else {
        fputs("Could not load icon source: \(source.path)\n", stderr)
        exit(1)
    }
    image.size = NSSize(width: 1024, height: 1024)
    try FileManager.default.createDirectory(at: iconSet, withIntermediateDirectories: true)

    for (filename, size) in iconSizes {
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: size,
            pixelsHigh: size,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            fputs("Could not create transparent bitmap for \(filename).\n", stderr)
            exit(1)
        }

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        NSColor.clear.setFill()
        NSRect(x: 0, y: 0, width: size, height: size).fill(using: .copy)
        image.draw(
            in: NSRect(x: 0, y: 0, width: size, height: size),
            from: NSRect(origin: .zero, size: image.size),
            operation: .sourceOver,
            fraction: 1,
            respectFlipped: false,
            hints: [.interpolation: NSImageInterpolation.high]
        )
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()

        let destination = iconSet.appendingPathComponent(filename)
        let png = bitmap.representation(using: .png, properties: [:])!
        try png.write(to: destination, options: .atomic)
    }
}
