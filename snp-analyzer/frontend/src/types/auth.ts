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
