export const betterAuth = jest.fn(() => ({
  handler: jest.fn(),
  api: {
    getSession: jest.fn().mockResolvedValue(null),
    signUpEmail: jest.fn(),
  },
  $Infer: { Session: { user: {}, session: {} } },
}));
