FROM maven:3.9.9-eclipse-temurin-8 AS build

ARG MAGE_REPO=https://github.com/magefree/mage.git
ARG MAGE_REF=56121238fc475d54ed4ca6ece5e5dc636c6f7df2

WORKDIR /src
RUN git clone --filter=blob:none "${MAGE_REPO}" . \
    && git checkout "${MAGE_REF}"
COPY webgateway/Mage.WebGateway ./Mage.WebGateway

RUN mkdir -p /out/lib /out/gateway /out/server \
    && sed -i '/<module>Mage.Server<\/module>/a\        <module>Mage.WebGateway</module>' pom.xml \
    && mvn -pl Mage.WebGateway,Mage.Server,Mage.Sets -am -DskipTests install \
    && mvn -pl Mage.Server -DskipTests assembly:single \
    && mvn -pl Mage.WebGateway,Mage.Sets -DskipTests org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy-dependencies -DincludeScope=runtime -DoutputDirectory=/out/lib \
    && cp Mage/target/mage.jar Mage.Common/target/mage-common.jar Mage.Sets/target/mage-sets.jar /out/lib/ \
    && cp Mage.WebGateway/target/mage-web-gateway.jar /out/gateway/mage-web-gateway.jar \
    && cd /out/server \
    && jar xf /src/Mage.Server/target/mage-server.zip

FROM eclipse-temurin:8-jre

ENV MAGE_SERVER_HOST=beta.xmage.today \
    MAGE_SERVER_PORT=17171 \
    MAGE_GATEWAY_PORT=17888 \
    MAGE_GATEWAY_HOST=0.0.0.0 \
    MAGE_GATEWAY_JAVA_OPTS="-Xms256m -Xmx384m -Xss512k -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ExitOnOutOfMemoryError -Djava.net.preferIPv4Stack=true" \
    MAGE_GATEWAY_MAX_SESSIONS=1000 \
    MAGE_GATEWAY_HTTP_THREADS=64 \
    MAGE_GATEWAY_HTTP_QUEUE=512 \
    MAGE_GATEWAY_SESSION_THREADS=64 \
    MAGE_GATEWAY_SESSION_QUEUE=256 \
    MAGE_GATEWAY_WEBSOCKET_THREADS=1200 \
    MAGE_GATEWAY_WEBSOCKET_QUEUE=0 \
    MAGE_GATEWAY_EVENT_BACKLOG=32 \
    MAGE_GATEWAY_SESSION_TTL_MINUTES=360 \
    MAGE_GATEWAY_COMPLETED_TTL_MINUTES=10 \
    MAGE_GATEWAY_WAITING_TTL_MINUTES=15 \
    MAGE_GATEWAY_IDLE_TTL_MINUTES=30 \
    MAGE_GATEWAY_MAX_REQUEST_BODY_BYTES=1048576 \
    MAGE_GATEWAY_BACKEND_STATS_INTERVAL_SECONDS=15 \
    MAGE_LOCAL_AI_SERVER=false \
    MAGE_LOCAL_SERVER_PORT=17171 \
    MAGE_LOCAL_SERVER_TEST_MODE=false \
    MAGE_LOCAL_SERVER_JAVA_OPTS="-Xms512m -Xmx768m -Xss512k -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ExitOnOutOfMemoryError -Djava.net.preferIPv4Stack=true"

WORKDIR /opt/mage

COPY --from=build /out/lib /opt/mage/lib
COPY --from=build /out/gateway /opt/mage/gateway
COPY --from=build /out/server /opt/mage/server
COPY --from=build /src/Mage.Server/target/mage-server.jar /opt/mage/server/lib/mage-server.jar
COPY docker/mage-entrypoint.sh /opt/mage/entrypoint.sh

RUN useradd --create-home --uid 10001 mage \
    && chown -R mage:mage /opt/mage \
    && chmod +x /opt/mage/entrypoint.sh

USER mage

EXPOSE 17888

ENTRYPOINT ["/opt/mage/entrypoint.sh"]
