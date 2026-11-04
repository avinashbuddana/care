import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Database } from '../../database/database.module';
import { verifyPassword } from './password';
import { z } from 'zod';
import { roles, type User } from '@platform/contracts';
import { loadEnvironment } from '../../config/environment';
import type { Request } from 'express';
const userRow = z.object({ id: z.string().uuid(), email: z.string(), role: roles });
const sessionUsers = new WeakMap<Request, User>();
export function requestUser(req: Request): User {
  const user = sessionUsers.get(req);
  if (!user) throw new UnauthorizedException();
  return user;
}
@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly db: Database) {}
  async login(email: string, password: string, ip: string): Promise<{ user: User; token: string }> {
    const now = Date.now();
    const previous = this.attempts.get(ip);
    if (previous && previous.until > now && previous.count >= 10)
      throw new HttpException('Too many login attempts; retry in 15 minutes', 429);
    if (this.attempts.size > 10000) this.attempts.clear();
    this.attempts.set(ip, {
      count: previous && previous.until > now ? previous.count + 1 : 1,
      until: now + 900000,
    });
    const rows = await this.db.query(
      'SELECT id,email,role,password_hash FROM platform.users WHERE email=$1',
      [email.toLowerCase()],
    );
    const row = rows[0];
    if (
      !row ||
      typeof row.password_hash !== 'string' ||
      !(await verifyPassword(password, row.password_hash))
    )
      throw new UnauthorizedException('Invalid email or password');
    const user = userRow.parse(row);
    const token = randomBytes(32).toString('hex');
    await this.db.query(
      "INSERT INTO platform.sessions(hash,user_id,expires_at) VALUES($1,$2,now()+($3||' hours')::interval)",
      [this.hash(token), user.id, loadEnvironment().SESSION_HOURS],
    );
    this.attempts.delete(ip);
    return { user, token };
  }
  async authenticate(req: Request): Promise<User> {
    const cookie = z.object({ session: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(req.cookies);
    if (!cookie.success) throw new UnauthorizedException();
    const rows = await this.db.query(
      'SELECT u.id,u.email,u.role FROM platform.users u JOIN platform.sessions s ON s.user_id=u.id WHERE s.hash=$1 AND s.expires_at>now()',
      [this.hash(cookie.data.session)],
    );
    if (!rows[0]) throw new UnauthorizedException();
    const user = userRow.parse(rows[0]);
    sessionUsers.set(req, user);
    return user;
  }
  async logout(req: Request): Promise<void> {
    const cookie = z.object({ session: z.string() }).safeParse(req.cookies);
    if (cookie.success)
      await this.db.query('DELETE FROM platform.sessions WHERE hash=$1', [
        this.hash(cookie.data.session),
      ]);
  }
  async dataset(user: User, datasetId: string, write = false): Promise<void> {
    if (user.role === 'admin') return;
    if (write && user.role !== 'operator') throw new ForbiddenException();
    const rows = await this.db.query(
      'SELECT can_import FROM platform.dataset_grants WHERE user_id=$1 AND dataset_id=$2',
      [user.id, datasetId],
    );
    if (!rows[0] || (write && rows[0].can_import !== true))
      throw new ForbiddenException('Dataset access not granted');
  }
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
