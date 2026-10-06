// Draws the Orbit Lab app icon (a planet with an orbit and a spacecraft) to a 1024×1024 PNG.
// Usage: swift mac/MakeIcon.swift <output.png>
import AppKit

let size: CGFloat = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext

// Rounded-square background, deep space gradient
let bg = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
bg.addClip()
NSGradient(colors: [NSColor(red: 0.05, green: 0.08, blue: 0.16, alpha: 1), NSColor(red: 0.01, green: 0.02, blue: 0.05, alpha: 1)])!
    .draw(in: bg, angle: -90)

// Stars
srand48(4)
for _ in 0..<70 {
    let r = CGFloat(drand48() * 4 + 1.5)
    NSColor(white: 1, alpha: CGFloat(drand48() * 0.6 + 0.3)).setFill()
    NSBezierPath(ovalIn: NSRect(x: 100 + CGFloat(drand48()) * 824, y: 100 + CGFloat(drand48()) * 824, width: r, height: r)).fill()
}

// Planet
let planet = NSRect(x: 352, y: 352, width: 320, height: 320)
NSGradient(colors: [NSColor(red: 0.42, green: 0.78, blue: 1.0, alpha: 1), NSColor(red: 0.08, green: 0.28, blue: 0.62, alpha: 1)])!
    .draw(in: NSBezierPath(ovalIn: planet), relativeCenterPosition: NSPoint(x: -0.35, y: 0.35))

// Orbit ellipse (tilted)
ctx.saveGState()
ctx.translateBy(x: 512, y: 512)
ctx.rotate(by: .pi / 9)
let orbit = NSBezierPath(ovalIn: NSRect(x: -360, y: -150, width: 720, height: 300))
orbit.lineWidth = 22
NSColor(red: 0.44, green: 0.83, blue: 1.0, alpha: 0.95).setStroke()
orbit.stroke()
// Spacecraft on the orbit
let craft = NSPoint(x: 360 * cos(0.55), y: 150 * sin(0.55))
NSColor(red: 1.0, green: 0.70, blue: 0.28, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: craft.x - 46, y: craft.y - 46, width: 92, height: 92)).fill()
NSColor.white.setStroke()
let ring = NSBezierPath(ovalIn: NSRect(x: craft.x - 46, y: craft.y - 46, width: 92, height: 92))
ring.lineWidth = 12
ring.stroke()
ctx.restoreGState()

image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
