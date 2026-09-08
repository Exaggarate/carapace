import Foundation
import CarapaceChatUI

extension MacGatewayChatTransport {
    func acquireNewSessionRouteLease() async -> CarapaceChatNewSessionRouteLease? {
        guard let serverLease = await self.connection.captureServerLease() else { return nil }
        guard await self.currentOutboxGatewayMatchesConnection() else { return nil }
        let request: @Sendable (CarapaceChatGatewayRequest) async throws -> Data = { request in
            try await self.connection.request(
                method: request.method,
                params: request.params,
                timeoutMs: request.timeoutMs,
                ifCurrentServerLease: serverLease)
        }
        return CarapaceChatNewSessionRouteLease(
            listAgents: {
                let data = try await request(CarapaceChatGatewayRequests.agentsList())
                return try CarapaceChatGatewayPayloadCodec.decodeAgentsList(data)
            },
            createSession: { key, label, explicitAgentID, parentSessionKey, worktree, worktreeBaseRef in
                let agentID = explicitAgentID
                    ?? CarapaceChatSessionKey.agentID(from: key)
                    ?? parentSessionKey.flatMap { CarapaceChatSessionKey.agentID(from: $0) }
                let createRequest = CarapaceChatGatewayRequests.createSession(
                    key: key,
                    agentID: agentID,
                    label: label,
                    parentSessionKey: parentSessionKey,
                    worktree: worktree,
                    worktreeBaseRef: worktreeBaseRef)
                let data = try await request(createRequest)
                return try JSONDecoder().decode(CarapaceChatCreateSessionResponse.self, from: data)
            })
    }

    func acquireSessionGroupsRouteLease() async -> CarapaceChatSessionGroupsRouteLease? {
        guard let serverLease = await self.connection.captureServerLease() else { return nil }
        guard await self.currentOutboxGatewayMatchesConnection() else { return nil }
        let request: @Sendable (CarapaceChatGatewayRequest) async throws -> Data = { request in
            try await self.connection.request(
                method: request.method,
                params: request.params,
                timeoutMs: request.timeoutMs,
                ifCurrentServerLease: serverLease)
        }
        return CarapaceChatSessionGroupsRouteLease(
            listGroups: {
                let data = try await request(CarapaceChatGatewayRequests.sessionGroupsList())
                return try JSONDecoder().decode(CarapaceChatSessionGroupsResponse.self, from: data)
            },
            putGroups: { names in
                let data = try await request(CarapaceChatGatewayRequests.sessionGroupsPut(names: names))
                return try JSONDecoder().decode(CarapaceChatSessionGroupsMutationResponse.self, from: data)
            },
            renameGroup: { name, to in
                let data = try await request(CarapaceChatGatewayRequests.sessionGroupsRename(name: name, to: to))
                return try JSONDecoder().decode(CarapaceChatSessionGroupsMutationResponse.self, from: data)
            },
            deleteGroup: { name in
                let data = try await request(CarapaceChatGatewayRequests.sessionGroupsDelete(name: name))
                return try JSONDecoder().decode(CarapaceChatSessionGroupsMutationResponse.self, from: data)
            })
    }

    func acquireSessionMutationRouteLease() async -> CarapaceChatSessionMutationRouteLease? {
        guard let serverLease = await self.connection.captureServerLease() else { return nil }
        guard await self.currentOutboxGatewayMatchesConnection() else { return nil }
        let unreadAckContract = await self.connection.supportsServerCapability(
            .sessionUnreadAckContract,
            ifCurrentServerLease: serverLease)
        let transport = self
        return CarapaceChatSessionMutationRouteLease(
            sessionTarget: { transport.sessionTarget(for: $0) },
            unreadAckContract: unreadAckContract,
            request: { request in
                try await self.connection.request(
                    method: request.method,
                    params: request.params,
                    timeoutMs: request.timeoutMs,
                    ifCurrentServerLease: serverLease)
            })
    }

    func requestChatSessionAction(_ request: CarapaceChatGatewayRequest) async throws -> Data {
        guard let serverLease = await self.connection.captureServerLease() else {
            throw CarapaceChatTransportSendError.notDispatched
        }
        try await self.requireCurrentOutboxGateway()
        return try await self.connection.request(
            method: request.method,
            params: request.params,
            timeoutMs: request.timeoutMs,
            ifCurrentServerLease: serverLease)
    }

    func forkSession(parentKey: String) async throws -> String {
        try await self.forkSession(parentKey: parentKey, fromLastCompleted: false)
    }

    func forkSession(parentKey: String, fromLastCompleted: Bool) async throws -> String {
        let target = self.sessionTarget(for: parentKey)
        let request = CarapaceChatGatewayRequests.forkSession(
            parentSessionKey: target.sessionKey,
            agentID: target.agentID,
            fromLastCompleted: fromLastCompleted)
        let data = try await self.requestChatSessionAction(request)
        return try JSONDecoder().decode(CarapaceChatCreateSessionResponse.self, from: data).key
    }
}
