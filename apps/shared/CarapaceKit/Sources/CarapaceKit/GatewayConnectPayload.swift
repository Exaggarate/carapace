import Foundation
import CarapaceProtocol

enum GatewayConnectPayload {
    static func makeClient(
        options: GatewayConnectOptions,
        displayName: String,
        platform: String) -> [String: CarapaceProtocol.AnyCodable]
    {
        var client: [String: CarapaceProtocol.AnyCodable] = [
            "id": CarapaceProtocol.AnyCodable(options.clientId),
            "displayName": CarapaceProtocol.AnyCodable(displayName),
            "version": CarapaceProtocol.AnyCodable(
                Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"),
            "platform": CarapaceProtocol.AnyCodable(platform),
            "mode": CarapaceProtocol.AnyCodable(options.clientMode),
            "instanceId": CarapaceProtocol.AnyCodable(InstanceIdentity.instanceId),
            "deviceFamily": CarapaceProtocol.AnyCodable(InstanceIdentity.deviceFamily),
        ]
        if let model = InstanceIdentity.modelIdentifier {
            client["modelIdentifier"] = CarapaceProtocol.AnyCodable(model)
        }
        return client
    }
}
