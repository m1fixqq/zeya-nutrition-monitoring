#!/usr/bin/env bash

# Запуск приложения в GitHub Codespaces.
# Скрипт можно вызывать повторно: если сервер уже работает, он ничего не делает.

set -u

if curl -fsS http://localhost:3000/api/auth/me >/dev/null 2>&1; then
  exit 0
fi

nohup npm start > /tmp/zeya-nutrition.log 2>&1 &
