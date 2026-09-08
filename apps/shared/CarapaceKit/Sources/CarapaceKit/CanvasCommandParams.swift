import Foundation

public struct CarapaceCanvasNavigateParams: Codable, Sendable, Equatable {
    public var url: String

    public init(url: String) {
        self.url = url
    }
}

public struct CarapaceCanvasPlacement: Codable, Sendable, Equatable {
    public var x: Double?
    public var y: Double?
    public var width: Double?
    public var height: Double?
}

public struct CarapaceCanvasPresentParams: Codable, Sendable, Equatable {
    public var url: String?
    public var placement: CarapaceCanvasPlacement?

    public init(url: String? = nil, placement: CarapaceCanvasPlacement? = nil) {
        self.url = url
        self.placement = placement
    }
}
