#!/usr/bin/env bash
# Hardening da VPS do worker (Ubuntu). Rodar UMA vez, como root:
#   bash bootstrap.sh <usuario-deploy> "<chave-publica-ssh-do-deploy>" "<chave-publica-ssh-do-admin>"
# A chave do admin (humano) garante o acesso root por chave; a chave do deploy é a do CI.
# ANTES de fechar a sessão, abrir outra e confirmar que o acesso por chave funciona.
set -euo pipefail
DEPLOY_USER="${1:?informe o usuário de deploy}"
PUBKEY="${2:?informe a chave pública SSH do deploy (CI)}"
ADMIN_PUBKEY="${3:?informe a chave pública SSH do admin (humano)}"
export DEBIAN_FRONTEND=noninteractive

# Acrescenta a chave se ainda não estiver lá. Se o arquivo não terminar em \n, completa antes:
# senão a chave nova seria colada no fim da última linha e nenhuma das duas funcionaria.
add_key() {
  local f="$1" key="$2"
  grep -qxF "$key" "$f" && return 0
  if [ -s "$f" ] && [ -n "$(tail -c1 "$f")" ]; then echo >> "$f"; fi
  printf '%s\n' "$key" >> "$f"
}

# Anti-lockout: garante a chave do admin no root ANTES de mexer no sshd
install -d -m 700 /root/.ssh
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
add_key /root/.ssh/authorized_keys "$ADMIN_PUBKEY"
if ! grep -qE '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys; then
  echo "ERRO: root sem chave autorizada; abortando antes de alterar o sshd." >&2
  exit 1
fi

apt-get update && apt-get -y upgrade
apt-get install -y ufw fail2ban unattended-upgrades ca-certificates curl

# Docker (repositório oficial)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Usuário de deploy: só chave SSH; grupo docker (equivale a root no host — por isso só chave e sem senha)
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
add_key "/home/$DEPLOY_USER/.ssh/authorized_keys" "$PUBKEY"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/atendimento

# SSH só por chave
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
sshd -t
systemctl reload ssh

# Firewall: entrada só SSH. (O worker não publica portas; Docker não abre nada.)
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban
echo "VPS pronta. Copie docker-compose.prod.yml e .env (chmod 600) para /opt/atendimento."
