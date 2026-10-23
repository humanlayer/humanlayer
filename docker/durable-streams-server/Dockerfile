FROM docker.io/rust:1.89-bookworm AS builder

ARG DURABLE_STREAMS_SOURCE_REPOSITORY=https://github.com/thesampaton/durable-streams-rust.git
ARG DURABLE_STREAMS_SOURCE_COMMIT=cebb50e49c62c534dd714ef84a8a4572e66724b2

RUN git clone "${DURABLE_STREAMS_SOURCE_REPOSITORY}" /src \
    && git -C /src checkout --detach "${DURABLE_STREAMS_SOURCE_COMMIT}" \
    && test "$(git -C /src rev-parse HEAD)" = "${DURABLE_STREAMS_SOURCE_COMMIT}"

WORKDIR /src
RUN cargo build --locked --release -p durable-streams-server

FROM docker.io/debian:bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /var/lib/durable-streams durable-streams \
    && install --directory --owner durable-streams --group durable-streams /var/lib/durable-streams

COPY --from=builder /src/target/release/durable-streams-server /usr/local/bin/durable-streams-server

EXPOSE 4437
# Named volumes created by the former Rivet service are root-owned. Fix only the
# mount point (not its potentially large contents), then drop privileges.
ENTRYPOINT ["/bin/sh", "-c", "chown durable-streams:durable-streams /var/lib/durable-streams && exec gosu durable-streams /usr/local/bin/durable-streams-server \"$@\"", "--"]
