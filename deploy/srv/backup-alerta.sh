#!/bin/sh
# Projeto mag-site — gancho de FALHA do backup diário (instalado em /srv/mag-site/backup-alerta.sh).
# Chamado pelo vps-backup-alerta (camada 3, por projeto) só quando a geração, o pacote, a cópia externa ou o hash
# falham; sucesso não chama nada. Reaproveita o alerta do catálogo: mesmo Telegram (/opt/mag-site/secrets/alert.env).
# Argumentos: <etapa> <código> [log]. Nunca muda o resultado do backup.
exec /opt/mag-site/bin/omie-alert.py backup "$@"
