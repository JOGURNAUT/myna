// ioredis-mock ships no types; it is API-compatible with ioredis' Redis class.
declare module 'ioredis-mock' {
  import type { Redis } from 'ioredis';
  const RedisMock: typeof Redis;
  export default RedisMock;
}
