"""A tiny Redis-protocol server for local runs without Docker (Hawk --instances 2).

Real deployments and CI use a real Redis; this speaks the same protocol (fakeredis' TCP server),
so the agent code path is identical. Usage: uv run python scripts/fake_redis.py <port>
"""

import sys

from fakeredis import TcpFakeServer

if __name__ == "__main__":
    port = int(sys.argv[1])
    server = TcpFakeServer(("127.0.0.1", port), server_type="redis")
    print(f"fake redis on 127.0.0.1:{port}", flush=True)
    server.serve_forever()
