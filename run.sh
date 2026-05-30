
  docker run --rm \
    --cpus=2 \
    --memory=1536m \
    --memory-swap=1536m \
    --ulimit nofile=65535:65535 \
    -p 17888:17888 \
    -e MAGE_GATEWAY_JAVA_OPTS="-Xms256m -Xmx384m -Xss512k -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ExitOnOutOfMemoryError -Djava.net.preferIPv4Stack=true" \
    mtg-mage-gateway
