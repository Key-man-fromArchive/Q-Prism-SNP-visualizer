# Stage 1: Build React frontend
FROM node:22-slim AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Vite outputs to ../app/static-react/ relative to frontend dir
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Copy React build output (Vite outputs to /build/app/static-react/)
COPY --from=frontend-build /build/app/static-react/ ./app/static-react/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
