import type { Role } from "./types";

/** Fictional demo users (mirrors backend/scenarios/directory.py; the backend is authoritative and re-checks every role). */
export const DEMO_USERS: { name: string; role: Role }[] = [
  { name: "A. Rao (demo engineer)", role: "engineer" },
  { name: "K. Iyer (demo asset owner)", role: "asset_owner" },
  { name: "R. Menon (demo officer)", role: "maintenance" },
  { name: "S. Gupta (demo officer)", role: "maintenance" },
  { name: "T. Nair (demo officer)", role: "maintenance" },
  { name: "P. Das (demo officer)", role: "maintenance" },
  { name: "A. Khan (demo officer)", role: "maintenance" },
  { name: "Guest viewer (demo)", role: "viewer" },
];
export const ROLE_LABEL: Record<Role, string> = { engineer: "Engineer", asset_owner: "Asset owner", maintenance: "Maintenance officer", viewer: "Viewer" };
