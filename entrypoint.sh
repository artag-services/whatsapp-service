#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Docker Entrypoint - Auto Migration Setup${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}\n"

# Get environment variables with defaults
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres123}"

SERVICE_NAME="${SERVICE_NAME:-microservice}"

echo -e "${YELLOW}[INFO]${NC} Initializing $SERVICE_NAME service..."
echo -e "${YELLOW}[INFO]${NC} PostgreSQL Host: $POSTGRES_HOST:$POSTGRES_PORT"

# ─────────────────────────────────────────────────────────────────
# STEP 1: Wait for PostgreSQL to be ready
# ─────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[STEP 1/3]${NC} Waiting for PostgreSQL to be ready..."

MAX_ATTEMPTS=0
until PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "postgres" -c '\q' 2>/dev/null; do
  MAX_ATTEMPTS=$((MAX_ATTEMPTS + 1))
  
  if [ $MAX_ATTEMPTS -eq 5 ]; then
    echo -e "${BLUE}  ⏳ Still waiting for PostgreSQL... (patience, this is normal on first start)${NC}"
  elif [ $MAX_ATTEMPTS -eq 15 ]; then
    echo -e "${BLUE}  ⏳ PostgreSQL is taking a while... waiting...${NC}"
  elif [ $MAX_ATTEMPTS -eq 30 ]; then
    echo -e "${BLUE}  ⏳ Still here, PostgreSQL should be up soon...${NC}"
  fi
  
  sleep 1
done

echo -e "${GREEN}✅ PostgreSQL is ready!${NC}"

# ─────────────────────────────────────────────────────────────────
# STEP 2: Generate Prisma Client
# ─────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[STEP 2/3]${NC} Generating Prisma Client..."

if [ -f "prisma/schema.prisma" ]; then
  pnpm prisma:generate 2>&1 | sed 's/^/  /'
  echo -e "${GREEN}✅ Prisma Client generated successfully!${NC}"
else
  echo -e "${BLUE}ℹ️  No Prisma schema found (stateless service)${NC}"
fi

# ─────────────────────────────────────────────────────────────────
# STEP 3: Run Database Migrations
# ─────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[STEP 3/3]${NC} Running database migrations..."

if [ -f "prisma/schema.prisma" ]; then
  if pnpm prisma:migrate deploy 2>&1 | sed 's/^/  /'; then
    echo -e "${GREEN}✅ Database migrations completed successfully!${NC}"
  else
    echo -e "${RED}⚠️  Migration encountered issues (continuing anyway)${NC}"
  fi
else
  echo -e "${BLUE}ℹ️  No Prisma schema found (skipping migrations)${NC}"
fi

# ─────────────────────────────────────────────────────────────────
# STEP 4: Start Application
# ─────────────────────────────────────────────────────────────────
echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🚀 All initialization steps completed!${NC}"
echo -e "${GREEN}   Starting $SERVICE_NAME service...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}\n"

# Execute the main command passed as arguments
exec "$@"
