import Foundation

public enum CarapaceCanvasCommand: String, Codable, Sendable {
    case present = "canvas.present"
    case hide = "canvas.hide"
    case navigate = "canvas.navigate"
}
