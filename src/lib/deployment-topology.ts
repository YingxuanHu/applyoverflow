function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export type DeploymentTopology = {
  workerPublicIpv4: string | null;
  workerPrivateIpv4: string | null;
  daemonDisabledInAppStack: boolean;
  privateWorkerDatabaseRouting: boolean;
};

export function getDeploymentTopology(): DeploymentTopology {
  const workerPublicIpv4 =
    readOptionalEnv("DO_WORKER_DROPLET_IPV4") ??
    readOptionalEnv("DO_DROPLET_IPV4");
  const workerPrivateIpv4 =
    readOptionalEnv("DO_WORKER_DROPLET_PRIVATE_IPV4") ??
    readOptionalEnv("DO_DROPLET_PRIVATE_IPV4");

  return {
    workerPublicIpv4,
    workerPrivateIpv4,
    daemonDisabledInAppStack: process.env.DISABLE_INGEST_DAEMON === "1",
    privateWorkerDatabaseRouting:
      process.env.DATABASE_PREFER_PRIVATE_FOR_WORKERS !== "0" &&
      Boolean(readOptionalEnv("DATABASE_URL_DO_PRIVATE")),
  };
}
