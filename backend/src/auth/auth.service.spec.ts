import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '../common/enums/role.enum';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockUsersService = {
      countUsers: jest.fn(),
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };

    const mockJwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'JWT_SECRET') return 'secret';
        if (key === 'JWT_REFRESH_SECRET') return 'refresh_secret';
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register a new user as ADMIN if there are zero users in the database', async () => {
      usersService.countUsers.mockResolvedValue(0);
      const mockSafeUser = {
        id: 'user-id-1',
        email: 'admin@broker.com',
        name: 'Initial Admin',
        role: Role.ADMIN,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Mock UsersService.create to return the full entity
      usersService.create.mockResolvedValue({
        ...mockSafeUser,
        passwordHash: 'hashedpwd',
      });

      const result = await service.register({
        email: 'admin@broker.com',
        name: 'Initial Admin',
        password: 'password123',
      });

      expect(usersService.countUsers).toHaveBeenCalled();
      expect(usersService.create).toHaveBeenCalledWith({
        email: 'admin@broker.com',
        name: 'Initial Admin',
        password: 'password123',
        role: Role.ADMIN,
      });
      expect(result).toEqual(mockSafeUser);
    });

    it('should register a new user with SUPPORT role by default if users exist', async () => {
      usersService.countUsers.mockResolvedValue(1);
      const mockSafeUser = {
        id: 'user-id-2',
        email: 'support@broker.com',
        name: 'Support Agent',
        role: Role.SUPPORT,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      usersService.create.mockResolvedValue({
        ...mockSafeUser,
        passwordHash: 'hashedpwd2',
      });

      const result = await service.register({
        email: 'support@broker.com',
        name: 'Support Agent',
        password: 'password123',
      });

      expect(usersService.create).toHaveBeenCalledWith({
        email: 'support@broker.com',
        name: 'Support Agent',
        password: 'password123',
        role: Role.SUPPORT,
      });
      expect(result).toEqual(mockSafeUser);
    });
  });

  describe('login', () => {
    it('should return session tokens and user details for valid credentials', async () => {
      const mockUser = {
        id: 'user-id-1',
        email: 'test@broker.com',
        name: 'Test Account',
        passwordHash: 'hashed_pwd',
        role: Role.SUPPORT,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      usersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync
        .mockResolvedValueOnce('access_token') // first call
        .mockResolvedValueOnce('refresh_token'); // second call

      const result = await service.login({
        email: 'test@broker.com',
        password: 'password123',
      });

      expect(usersService.findByEmail).toHaveBeenCalledWith('test@broker.com');
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed_pwd');
      expect(result.accessToken).toBe('access_token');
      expect(result.refreshToken).toBe('refresh_token');
      expect(result.user.email).toBe(mockUser.email);
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      const mockUser = {
        id: 'user-id-1',
        email: 'test@broker.com',
        name: 'Test Account',
        passwordHash: 'hashed_pwd',
        role: Role.SUPPORT,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      usersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({
          email: 'test@broker.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
