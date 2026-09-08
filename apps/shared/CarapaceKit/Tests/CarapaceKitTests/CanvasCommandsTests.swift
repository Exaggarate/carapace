import Foundation
import CarapaceKit
import Testing

struct CanvasCommandsTests {
    @Test func `presenter command strings are stable`() {
        #expect(CarapaceCanvasCommand.present.rawValue == "canvas.present")
        #expect(CarapaceCanvasCommand.hide.rawValue == "canvas.hide")
        #expect(CarapaceCanvasCommand.navigate.rawValue == "canvas.navigate")
    }

    @Test func `presenter params decode shipped wire shapes`() throws {
        let presentData = try #require(
            """
            {"url":"carapace-canvas://widget.html","placement":{"x":1,"y":2,"width":3,"height":4}}
            """.data(using: .utf8))
        let present = try JSONDecoder().decode(CarapaceCanvasPresentParams.self, from: presentData)
        #expect(present.url == "carapace-canvas://widget.html")
        #expect(present.placement?.x == 1)
        #expect(present.placement?.y == 2)
        #expect(present.placement?.width == 3)
        #expect(present.placement?.height == 4)

        let navigateData = try #require(
            "{\"url\":\"carapace-canvas://next.html\"}".data(using: .utf8))
        let navigate = try JSONDecoder().decode(CarapaceCanvasNavigateParams.self, from: navigateData)
        #expect(navigate.url == "carapace-canvas://next.html")
    }
}
