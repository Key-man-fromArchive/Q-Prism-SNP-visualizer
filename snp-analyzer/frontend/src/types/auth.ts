export type User = {
  id: string;
  username: string;
  display_name: string | null;
  role: 'admin' | 'user';
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  user: User;
};

export type UserListItem = {
  id: string;
  username: string;
  display_name: string | null;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
};

export type AdminDashboardSession = {
  session_id: string;
  instrument: string;
  num_wells: number;
  num_cycles: number;
  raw_filename: string;
  created_at: string;
};

export type AdminDashboardProject = {
  id: string;
  name: string;
  session_count: number;
  created_at: string;
};

export type AdminDashboardUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  session_count: number;
  project_count: number;
  total_data_points: number;
  sessions: AdminDashboardSession[];
  projects: AdminDashboardProject[];
};

export type AdminDashboardResponse = {
  users: AdminDashboardUser[];
};
