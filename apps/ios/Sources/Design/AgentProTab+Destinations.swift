import CarapaceKit
import CarapaceProtocol
import SwiftUI

extension AgentProTab {
    @ViewBuilder
    func destination(for route: AgentRoute) -> some View {
        switch route {
        case .agents:
            self.agentsDestination
        case .files:
            self.filesDestination
        }
    }

    var filesDestination: some View {
        AgentWorkspaceFilesScreen(
            agentId: self.activeAgentID,
            headerSidebarAction: self.directHeaderSidebarAction(for: .files))
    }

    var agentsDestination: some View {
        List {
            Section {
                if self.filteredAgents.isEmpty {
                    self.emptyAgentsRow
                } else {
                    ForEach(self.filteredAgents, id: \.id) { agent in
                        self.agentRow(agent)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(self.headerTitle)
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: self.$agentSearchText, prompt: "Search agents")
        .refreshable {
            await self.refreshAgents()
        }
        .font(CarapaceType.body)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                self.agentFilterMenu
                self.gatewayToolbarButton
            }
            if let headerSidebarAction {
                CarapaceSidebarToolbarItem(
                    action: headerSidebarAction,
                    placement: .topBarLeading)
            }
        }
    }

    func directHeaderSidebarAction(for route: AgentRoute) -> CarapaceSidebarHeaderAction? {
        self.directRoute == route ? self.headerSidebarAction : nil
    }
}
