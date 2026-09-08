// pm2 process definition for the Carapace gateway — process-level durability:
// autorestart with exponential backoff, memory ceiling, and a kill timeout that
// matches the gateway's 15s shutdown grace so in-flight turns drain on restart.
//
// Usage (see docs/index.md "Deployment with pm2"):
//   pm2 start ecosystem.config.cjs
//   pm2 logs carapace-gateway
//   pm2 save            # persist the process list for boot resurrection
//
// Credentials are sourced from ~/.carapace/gateway.env by scripts/start-gateway.sh.
// Never embed secret values in this file — pm2 dumps ecosystem env into ~/.pm2/dump.pm2.
module.exports = {
  apps: [
    {
      name: "carapace-gateway",
      script: "scripts/start-gateway.sh",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      // Restart policy: tolerate crash-loops (max 20 unstable restarts inside the
      // min_uptime window), back off exponentially between them, stop retrying a
      // hopeless app rather than hammering it forever.
      max_restarts: 20,
      min_uptime: "30s",
      exp_backoff_restart_delay: 1000,
      max_memory_restart: "512M",
      // Graceful drain window for SIGTERM/SIGINT (agent.announceTarget turns,
      // telegram offsets, sqlite WAL checkpoint) — mirrors SHUTDOWN_GRACE_MS.
      kill_timeout: 15000,
      time: true,
    },
  ],
};