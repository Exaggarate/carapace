import CoreLocation
import Foundation
import CarapaceKit
import UIKit

typealias CarapaceCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias CarapaceCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(
        params: CarapaceCameraSnapParams,
        defaultFacing: CarapaceCameraFacing) async throws -> CarapaceCameraSnapResult
    func clip(
        params: CarapaceCameraClipParams,
        defaultFacing: CarapaceCameraFacing) async throws -> CarapaceCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func authorizationSnapshot() -> LocationAuthorizationSnapshot
    func ensureAuthorization(
        mode: CarapaceLocationMode,
        isCurrent: @MainActor () -> Bool) async -> CLAuthorizationStatus
    func currentLocation(
        params: CarapaceLocationGetParams,
        desiredAccuracy: CarapaceLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func setBackgroundLocationUpdatesEnabled(_ enabled: Bool)
    func setAuthorizationChangeHandler(
        _ handler: @escaping @MainActor @Sendable (LocationAuthorizationSnapshot) -> Void)
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

extension LocationServicing {
    func authorizationSnapshot() -> LocationAuthorizationSnapshot {
        LocationAuthorizationSnapshot(
            authorizationStatus: self.authorizationStatus(),
            accuracyAuthorization: self.accuracyAuthorization())
    }
}

@MainActor
protocol DeviceStatusServicing: Sendable {
    func status() async throws -> CarapaceDeviceStatusPayload
    func info() -> CarapaceDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: CarapacePhotosLatestParams) async throws -> CarapacePhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: CarapaceContactsSearchParams) async throws -> CarapaceContactsSearchPayload
    func add(params: CarapaceContactsAddParams) async throws -> CarapaceContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: CarapaceCalendarEventsParams) async throws -> CarapaceCalendarEventsPayload
    func add(params: CarapaceCalendarAddParams) async throws -> CarapaceCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: CarapaceRemindersListParams) async throws -> CarapaceRemindersListPayload
    func add(params: CarapaceRemindersAddParams) async throws -> CarapaceRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: CarapaceMotionActivityParams) async throws -> CarapaceMotionActivityPayload
    func pedometer(params: CarapacePedometerParams) async throws -> CarapacePedometerPayload
}

struct WatchMessagingStatus: Equatable, Sendable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchExecApprovalResolveEvent: Codable, Equatable, Sendable {
    var replyId: String
    var approvalId: String
    var gatewayStableID: String?
    var decision: CarapaceWatchExecApprovalDecision
    var sentAtMs: Int64?
    var transport: String
}

struct WatchExecApprovalSnapshotRequestItem: Equatable, Sendable {
    var approvalId: String
    var activeResolutionAttemptId: String?
}

struct WatchExecApprovalSnapshotRequestEvent: Equatable, Sendable {
    var requestId: String
    var gatewayStableID: String?
    var heldApprovals: [WatchExecApprovalSnapshotRequestItem]
    var sentAtMs: Int64?
    var transport: String

    init(
        requestId: String,
        gatewayStableID: String? = nil,
        heldApprovals: [WatchExecApprovalSnapshotRequestItem] = [],
        sentAtMs: Int64?,
        transport: String)
    {
        self.requestId = requestId
        self.gatewayStableID = gatewayStableID
        self.heldApprovals = heldApprovals
        self.sentAtMs = sentAtMs
        self.transport = transport
    }
}

struct WatchAppSnapshotRequestEvent: Equatable, Sendable {
    var requestId: String
    var sentAtMs: Int64?
    var transport: String
}

struct WatchAppCommandEvent: Codable, Equatable, Sendable {
    var commandId: String
    var command: CarapaceWatchAppCommand
    var sessionKey: String?
    var gatewayStableID: String?
    var text: String?
    var sentAtMs: Int64?
    var transport: String
}

struct WatchNotificationSendResult: Equatable, Sendable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setStatusHandler(_ handler: (@Sendable (WatchMessagingStatus) -> Void)?)
    func setChatDeliveryHandler(
        _ handler: (@Sendable (CarapaceWatchChatDeliveryCommand) async throws -> Void)?)
    func setChatDeliveryReceiptAckHandler(
        _ handler: (@Sendable (CarapaceWatchChatDeliveryReceiptAck) async throws -> Void)?)
    func setLegacyChatRejectedHandler(_ handler: (@Sendable () -> Void)?)
    func setExecApprovalResolveHandler(_ handler: (@Sendable (WatchExecApprovalResolveEvent) -> Void)?)
    func setExecApprovalSnapshotRequestHandler(
        _ handler: (@Sendable (WatchExecApprovalSnapshotRequestEvent) -> Void)?)
    func setAppSnapshotRequestHandler(_ handler: (@Sendable (WatchAppSnapshotRequestEvent) -> Void)?)
    func setAppCommandHandler(_ handler: (@Sendable (WatchAppCommandEvent) -> Void)?)
    func sendDirectNodeSetup(setupCode: String) async throws -> WatchNotificationSendResult
    func sendNotification(
        id: String,
        params: CarapaceWatchNotifyParams,
        gatewayStableID: String?,
        chatDeliveryContext: CarapaceWatchChatDeliveryContext?) async throws -> WatchNotificationSendResult
    func sendExecApprovalPrompt(
        _ message: CarapaceWatchExecApprovalPromptMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalResolved(
        _ message: CarapaceWatchExecApprovalResolvedMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalExpired(
        _ message: CarapaceWatchExecApprovalExpiredMessage) async throws -> WatchNotificationSendResult
    func syncExecApprovalSnapshot(
        _ message: CarapaceWatchExecApprovalSnapshotMessage) async throws -> WatchNotificationSendResult
    func syncAppSnapshot(
        _ message: CarapaceWatchAppSnapshotMessage) async throws -> WatchNotificationSendResult
    func sendChatDeliveryReceipt(
        _ receipt: CarapaceWatchChatDeliveryReceipt) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
