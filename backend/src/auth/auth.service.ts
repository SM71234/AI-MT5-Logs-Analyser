import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from '@prisma/client';
import { Role } from '../common/enums/role.enum';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto): Promise<Omit<User, 'passwordHash'>> {
    // If no users exist, seed the first user as ADMIN automatically to enable setup
    const totalUsersCount = await this.usersService.countUsers();
    const assignedRole = totalUsersCount === 0 ? Role.ADMIN : (registerDto.role || Role.SUPPORT);

    const user = await this.usersService.create({
      email: registerDto.email.toLowerCase(),
      name: registerDto.name,
      password: registerDto.password,
      role: assignedRole,
    });

    this.logger.log(`User created: ${user.email} with role ${user.role}`);
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  async login(loginDto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Omit<User, 'passwordHash'>;
  }> {
    const emailNormalized = loginDto.email.toLowerCase();
    let user: User;
    try {
      user = await this.usersService.findByEmail(emailNormalized);
    } catch {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRATION', '8h'),
      }),
      this.jwtService.signAsync(
        { sub: user.id },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d'),
        },
      ),
    ]);

    this.logger.log(`Successful login for user: ${user.email}`);

    const { passwordHash, ...safeUser } = user;
    return {
      accessToken,
      refreshToken,
      user: safeUser,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.usersService.findById(payload.sub);
      const newPayload = { sub: user.id, email: user.email, role: user.role };

      const accessToken = await this.jwtService.signAsync(newPayload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRATION', '8h'),
      });

      return { accessToken };
    } catch (error) {
      this.logger.warn('Failed attempt to refresh access token');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
