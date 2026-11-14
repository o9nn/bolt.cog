# Pin this image to a reviewed digest before production use.
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    RUNNER_HOST=0.0.0.0 \
    RUNNER_PORT=8788 \
    RUNNER_WORKSPACE_ROOT=/workspace \
    RUNNER_AUDIT_PATH=/audit/events.jsonl

WORKDIR /opt/linux-runner
COPY --chown=root:root runner.mjs /opt/linux-runner/runner.mjs
RUN chmod 0444 /opt/linux-runner/runner.mjs \
    && mkdir /workspace /audit \
    && chown node:node /audit \
    && chmod 0700 /audit

USER 1000:1000
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "import http from 'node:http'; const req=http.get('http://127.0.0.1:8788/health',res=>{res.resume(); process.exitCode=res.statusCode===200?0:1;}); req.setTimeout(2000,()=>{req.destroy();process.exitCode=1;}); req.on('error',()=>{process.exitCode=1;});"]
ENTRYPOINT ["node", "/opt/linux-runner/runner.mjs"]
