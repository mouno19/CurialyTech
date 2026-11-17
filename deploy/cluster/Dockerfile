# curialy-sandbox-runner: the image every Curialy Dedicated Isolated Compute sandbox starts from.
# Node.js 20, Python 3, Git and build tools on Debian 12. Commands run as root inside the container;
# the Docker daemon remaps that root to an unprivileged user on the worker (userns-remap).
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git build-essential ca-certificates curl wget sudo procps unzip xz-utils less \
 && rm -rf /var/lib/apt/lists/* \
 && npm config set update-notifier false -g \
 && mkdir -p /home/user/workspace

ENV HOME=/home/user \
    CI=1 \
    TERM=dumb \
    NO_COLOR=1 \
    LANG=C.UTF-8 \
    npm_config_update_notifier=false \
    GIT_TERMINAL_PROMPT=0
WORKDIR /home/user/workspace
CMD ["sleep", "infinity"]
