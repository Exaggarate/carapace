// Matrix plugin module implements device health behavior.
export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleCarapaceDevices: MatrixManagedDeviceInfo[];
  currentCarapaceDevices: MatrixManagedDeviceInfo[];
};

const CARAPACE_DEVICE_NAME_PREFIX = "Carapace ";

export function isCarapaceManagedMatrixDevice(displayName: string | null | undefined): boolean {
  return displayName?.startsWith(CARAPACE_DEVICE_NAME_PREFIX) === true;
}

export function summarizeMatrixDeviceHealth(
  devices: MatrixManagedDeviceInfo[],
): MatrixDeviceHealthSummary {
  const currentDeviceId = devices.find((device) => device.current)?.deviceId ?? null;
  const carapaceDevices = devices.filter((device) =>
    isCarapaceManagedMatrixDevice(device.displayName),
  );
  return {
    currentDeviceId,
    staleCarapaceDevices: carapaceDevices.filter((device) => !device.current),
    currentCarapaceDevices: carapaceDevices.filter((device) => device.current),
  };
}
