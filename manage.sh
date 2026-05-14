#!/bin/bash

# manage.sh for A2Z Organizational Prototype

COMMAND=$1

generate_ssl() {
    echo "Checking for SSL certificates..."
    mkdir -p ssl
    APP_HOST=${APP_HOST:-localhost}
    CERT_HOST_TRACK_FILE="ssl/.cert_host"
    PREVIOUS_CERT_HOST=""

    if [ -f "$CERT_HOST_TRACK_FILE" ]; then
        PREVIOUS_CERT_HOST=$(cat "$CERT_HOST_TRACK_FILE")
    fi

    if [ ! -f ssl/cert.pem ] || [ ! -f ssl/key.pem ] || [ "$PREVIOUS_CERT_HOST" != "$APP_HOST" ]; then
        SAN_ENTRIES="DNS:localhost,DNS:${APP_HOST}"
        if [[ "$APP_HOST" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
            SAN_ENTRIES="${SAN_ENTRIES},IP:${APP_HOST}"
        fi

        echo "Generating self-signed SSL certificate for host: $APP_HOST"
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout ssl/key.pem -out ssl/cert.pem \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=${APP_HOST}" \
            -addext "subjectAltName=${SAN_ENTRIES}"
        echo "$APP_HOST" > "$CERT_HOST_TRACK_FILE"
        echo "SSL certificate generated."
    else
        echo "SSL certificate already exists."
    fi
}

case "$COMMAND" in
    start)
        generate_ssl
        docker-compose up -d
        ;;
    stop)
        docker-compose down
        ;;
    rebuild)
        generate_ssl
        docker-compose down -v
        docker-compose up --build -d
        ;;
    logs)
        docker-compose logs -f
        ;;
    *)
        echo "Usage: ./manage.sh {start|stop|rebuild|logs}"
        exit 1
        ;;
esac
