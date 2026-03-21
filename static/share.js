(function () {
  "use strict";

  const snapshot = window.__REMOTELAB_SHARE__ || {};
  const messagesInner = document.getElementById("messagesInner");
  const snapshotTitle = document.getElementById("snapshotTitle");
  const snapshotMeta = document.getElementById("snapshotMeta");
  const heroBadge = document.getElementById("heroBadge");
  const heroNote = document.getElementById("heroNote");

  const view = snapshot.view && typeof snapshot.view === "object"
    ? snapshot.view
    : {};

  function renderShareIcon(name, className = "") {
    return window.RemoteLabIcons?.render(name, { className }) || "";
  }

  let currentThinkingBlock = null;
  let inThinkingBlock = false;

  function formatDate(value) {
    if (!value) return "未知";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "未知";
    return dt.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function esc(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span.innerHTML;
  }

  function copyText(text) {
    if (!text) return Promise.resolve();
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand("copy");
      textarea.remove();
      if (copied) resolve();
      else reject(new Error("复制失败"));
    });
  }

  function setCopyButtonState(button, copied) {
    const icon = copied
      ? `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M13.5 4.5 6.5 11.5 3 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`
      : `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="5" y="3" width="8" height="10" rx="1.5" ry="1.5" fill="none" stroke="currentColor" stroke-width="1.4"></rect><path d="M3 10.5V4.5C3 3.67 3.67 3 4.5 3H10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg>`;
    button.innerHTML = icon;
    button.classList.toggle("copied", copied);
    button.title = copied ? "已复制" : "复制代码";
    button.setAttribute("aria-label", copied ? "已复制" : "复制代码");
  }

  function enhanceCodeBlocks(root) {
    const blocks = root.querySelectorAll("pre > code");
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.parentElement?.classList.contains("code-block-wrap")) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "code-block-wrap";
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy-btn";
      setCopyButtonState(button, false);

      let resetTimer = null;
      button.addEventListener("click", async () => {
        try {
          await copyText(code.textContent || "");
          setCopyButtonState(button, true);
          window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(() => setCopyButtonState(button, false), 1600);
        } catch (err) {
          console.warn("[share] Failed to copy code block:", err.message);
        }
      });

      wrapper.appendChild(button);
    }
  }

  function sanitizeRenderedContent(root) {
    root.querySelectorAll("script, iframe, object, embed, form, input, textarea, button, style, link, meta, base, img").forEach((el) => el.remove());

    root.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }
    });

    root.querySelectorAll("a[href]").forEach((link) => {
      const href = (link.getAttribute("href") || "").trim();
      const lower = href.toLowerCase();
      if (!/^(https?:|mailto:|tel:)/.test(lower)) {
        link.removeAttribute("href");
        return;
      }
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }

  function registerMarkdownExtensions() {
    const hiddenTagStart = /<(private|hide)\b/i;
    const hiddenBlockPattern = /^(?: {0,3})<(private|hide)\b[^>]*>[\s\S]*?<\/\1>(?:\n+|$)/i;
    const hiddenInlinePattern = /^<(private|hide)\b[^>]*>[\s\S]*?<\/\1>/i;

    marked.use({
      renderer: {
        html() {
          return "";
        },
      },
      extensions: [
        {
          name: "hiddenShareBlock",
          level: "block",
          start(src) {
            const match = src.match(hiddenTagStart);
            return match ? match.index : undefined;
          },
          tokenizer(src) {
            const match = src.match(hiddenBlockPattern);
            if (!match) return undefined;
            return { type: "hiddenShareBlock", raw: match[0] };
          },
          renderer() {
            return "";
          },
        },
        {
          name: "hiddenShareInline",
          level: "inline",
          start(src) {
            const match = src.match(hiddenTagStart);
            return match ? match.index : undefined;
          },
          tokenizer(src) {
            const match = src.match(hiddenInlinePattern);
            if (!match) return undefined;
            return { type: "hiddenShareInline", raw: match[0] };
          },
          renderer() {
            return "";
          },
        },
      ],
    });
  }

  function openThinkingBlock() {
    const block = document.createElement("div");
    block.className = "thinking-block collapsed";

    const header = document.createElement("div");
    header.className = "thinking-header";
    header.innerHTML = `${renderShareIcon("gear", "thinking-icon")}<span class="thinking-label">思考中…</span><span class="thinking-chevron">${renderShareIcon("chevron-down")}</span>`;

    const body = document.createElement("div");
    body.className = "thinking-body";

    header.addEventListener("click", () => {
      block.classList.toggle("collapsed");
    });

    block.appendChild(header);
    block.appendChild(body);
    messagesInner.appendChild(block);

    currentThinkingBlock = {
      el: block,
      body,
      label: header.querySelector(".thinking-label"),
      tools: new Set(),
    };
    inThinkingBlock = true;
  }

  function finalizeThinkingBlock() {
    if (!currentThinkingBlock) return;
    const toolList = [...currentThinkingBlock.tools];
    currentThinkingBlock.label.textContent = toolList.length > 0
      ? `思考过程 · 使用了 ${toolList.join(", ")}`
      : "思考过程";
    inThinkingBlock = false;
    currentThinkingBlock = null;
  }

  function getThinkingBody() {
    if (!inThinkingBlock) openThinkingBlock();
    return currentThinkingBlock.body;
  }

  function getAttachmentDisplayName(attachment) {
    const originalName = typeof attachment?.originalName === "string"
      ? attachment.originalName.trim()
      : "";
    if (originalName) return originalName;
    const filename = typeof attachment?.filename === "string"
      ? attachment.filename.trim()
      : "";
    return filename || "附件";
  }

  function createAttachmentNode(attachment) {
    const mimeType = typeof attachment?.mimeType === "string"
      ? attachment.mimeType
      : "application/octet-stream";
    const src = typeof attachment?.url === "string" && attachment.url
      ? attachment.url
      : (attachment?.data ? `data:${mimeType};base64,${attachment.data}` : "");
    if (!src) return null;
    if (mimeType.startsWith("image/")) {
      const imgEl = document.createElement("img");
      imgEl.src = src;
      imgEl.alt = getAttachmentDisplayName(attachment);
      imgEl.loading = "lazy";
      imgEl.addEventListener("click", () => window.open(src, "_blank", "noopener,noreferrer"));
      return imgEl;
    }
    if (mimeType.startsWith("video/")) {
      const videoEl = document.createElement("video");
      videoEl.src = src;
      videoEl.controls = true;
      videoEl.preload = "metadata";
      videoEl.playsInline = true;
      return videoEl;
    }

    const link = document.createElement("a");
    link.href = src;
    link.textContent = getAttachmentDisplayName(attachment);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.download = getAttachmentDisplayName(attachment);
    link.className = "attachment-link";
    return link;
  }

  function renderMessage(event) {
    const role = event.role || "assistant";
    if (inThinkingBlock) finalizeThinkingBlock();

    if (role === "user") {
      const wrap = document.createElement("div");
      wrap.className = "msg-user";

      const bubble = document.createElement("div");
      bubble.className = "msg-user-bubble";

      if (Array.isArray(event.images) && event.images.length > 0) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "msg-images";
        for (const image of event.images) {
          const attachmentNode = createAttachmentNode(image);
          if (!attachmentNode) continue;
          imgWrap.appendChild(attachmentNode);
        }
        if (imgWrap.childNodes.length > 0) {
          bubble.appendChild(imgWrap);
        }
      }

      if (event.content) {
        const span = document.createElement("span");
        span.textContent = event.content;
        bubble.appendChild(span);
      }

      wrap.appendChild(bubble);
      messagesInner.appendChild(wrap);
      return;
    }

    const div = document.createElement("div");
    div.className = "msg-assistant";
    const rendered = marked.parse(event.content || "");
    if (!rendered.trim()) return;
    div.innerHTML = rendered;
    sanitizeRenderedContent(div);
    enhanceCodeBlocks(div);
    messagesInner.appendChild(div);
  }

  function renderToolUse(event) {
    const container = getThinkingBody();
    if (currentThinkingBlock && event.toolName) {
      currentThinkingBlock.tools.add(event.toolName);
    }

    const card = document.createElement("div");
    card.className = "tool-card";

    const header = document.createElement("div");
    header.className = "tool-header";
    header.innerHTML = `<span class="tool-name">${esc(event.toolName || "工具")}</span><span class="tool-toggle">${renderShareIcon("chevron-right")}</span>`;

    const body = document.createElement("div");
    body.className = "tool-body";
    body.id = "tool_" + (event.id || Date.now());

    const pre = document.createElement("pre");
    pre.textContent = event.toolInput || "";
    body.appendChild(pre);

    header.addEventListener("click", () => {
      header.classList.toggle("expanded");
      body.classList.toggle("expanded");
    });

    card.appendChild(header);
    card.appendChild(body);
    card.dataset.toolId = event.id || "";
    container.appendChild(card);
  }

  function renderStandaloneToolResult(event) {
    const container = getThinkingBody();
    const card = document.createElement("div");
    card.className = "tool-card";

    const header = document.createElement("div");
    header.className = "tool-header expanded";
    header.innerHTML = `<span class="tool-name">${esc(event.toolName || "工具")}</span><span class="tool-toggle">${renderShareIcon("chevron-right")}</span>`;

    const body = document.createElement("div");
    body.className = "tool-body expanded";

    const label = document.createElement("div");
    label.className = "tool-result-label";
    label.innerHTML = `结果${event.exitCode !== undefined ? `<span class="exit-code ${event.exitCode === 0 ? "ok" : "fail"}">${event.exitCode === 0 ? "退出码 0" : "退出码 " + event.exitCode}</span>` : ""}`;

    const pre = document.createElement("pre");
    pre.className = "tool-result";
    pre.textContent = event.output || "";

    body.appendChild(label);
    body.appendChild(pre);
    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  }

  function renderToolResult(event) {
    const searchRoot = inThinkingBlock && currentThinkingBlock ? currentThinkingBlock.body : messagesInner;
    const cards = searchRoot.querySelectorAll(".tool-card");
    let targetCard = null;
    for (let i = cards.length - 1; i >= 0; i -= 1) {
      if (!cards[i].querySelector(".tool-result")) {
        targetCard = cards[i];
        break;
      }
    }

    if (!targetCard) {
      renderStandaloneToolResult(event);
      return;
    }

    const body = targetCard.querySelector(".tool-body");
    const label = document.createElement("div");
    label.className = "tool-result-label";
    label.innerHTML = `结果${event.exitCode !== undefined ? `<span class="exit-code ${event.exitCode === 0 ? "ok" : "fail"}">${event.exitCode === 0 ? "退出码 0" : "退出码 " + event.exitCode}</span>` : ""}`;

    const pre = document.createElement("pre");
    pre.className = "tool-result";
    pre.textContent = event.output || "";

    body.appendChild(label);
    body.appendChild(pre);
    if (event.exitCode && event.exitCode !== 0) {
      targetCard.querySelector(".tool-header")?.classList.add("expanded");
      body.classList.add("expanded");
    }
  }

  function renderFileChange(event) {
    const container = getThinkingBody();
    const div = document.createElement("div");
    div.className = "file-card";
    const kind = event.changeType || "edit";
    div.innerHTML = `<span class="file-path">${esc(event.filePath || "")}</span><span class="change-type ${esc(kind)}">${esc(kind)}</span>`;
    container.appendChild(div);
  }

  function renderReasoning(event) {
    const container = getThinkingBody();
    const div = document.createElement("div");
    div.className = "reasoning msg-assistant";
    const rendered = marked.parse(event.content || "");
    if (!rendered.trim()) return;
    div.innerHTML = rendered;
    sanitizeRenderedContent(div);
    enhanceCodeBlocks(div);
    container.appendChild(div);
  }

  function renderStatus(event) {
    if (inThinkingBlock && event.content !== "thinking") {
      finalizeThinkingBlock();
    }
    if (!event.content || event.content === "thinking" || event.content === "completed") return;
    const div = document.createElement("div");
    div.className = "msg-system";
    div.textContent = event.content;
    messagesInner.appendChild(div);
  }

  function renderContextBarrier(event) {
    if (inThinkingBlock) {
      finalizeThinkingBlock();
    }
    const div = document.createElement("div");
    div.className = "context-barrier";
    div.textContent = event.content || "此标记以上的旧消息已不再处于当前实时上下文中。";
    messagesInner.appendChild(div);
  }

  function formatCompactTokens(n) {
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n < 1000) return `${Math.round(n)}`;
    return `${Math.round(n / 1000)}K`;
  }

  function renderUsage(event) {
    const contextSize = Number.isFinite(event.contextTokens)
      ? event.contextTokens
      : 0;
    if (!(contextSize > 0)) return;
    const contextWindowSize = Number.isFinite(event.contextWindowTokens)
      ? event.contextWindowTokens
      : 0;
    const percent = contextWindowSize > 0
      ? (contextSize / contextWindowSize) * 100
      : null;
    const output = event.outputTokens || 0;
    const div = document.createElement("div");
    div.className = "usage-info";
    const parts = [`${formatCompactTokens(contextSize)} 实时上下文`];
    if (percent !== null) parts.push(`${percent.toFixed(1)}% 窗口`);
    if (output > 0) parts.push(`${formatCompactTokens(output)} 输出`);
    div.textContent = parts.join(" · ");
    div.title = percent !== null
      ? `实时上下文：${contextSize.toLocaleString()} / ${contextWindowSize.toLocaleString()}（${percent.toFixed(1)}%）`
      : `实时上下文：${contextSize.toLocaleString()}`;
    messagesInner.appendChild(div);
  }

  function renderEvent(event) {
    switch (event.type) {
      case "message":
        renderMessage(event);
        break;
      case "tool_use":
        renderToolUse(event);
        break;
      case "tool_result":
        renderToolResult(event);
        break;
      case "file_change":
        renderFileChange(event);
        break;
      case "reasoning":
        renderReasoning(event);
        break;
      case "status":
        renderStatus(event);
        break;
      case "context_barrier":
        renderContextBarrier(event);
        break;
      case "usage":
        renderUsage(event);
        break;
      default:
        break;
    }
  }

  function renderMeta() {
    const name = snapshot.session?.name || snapshot.session?.tool || "共享会话快照";
    const tool = snapshot.session?.tool || "未知工具";
    const timestampLabel = typeof view.timestampLabel === "string" && view.timestampLabel
      ? view.timestampLabel
      : "分享时间";
    const titleSuffix = typeof view.titleSuffix === "string" && view.titleSuffix
      ? view.titleSuffix
      : "共享快照";
    const badge = typeof view.badge === "string" && view.badge
      ? view.badge
      : "只读快照";
    const note = typeof view.note === "string" && view.note
      ? view.note
      : "此链接仅公开当前捕获到的对话快照。它不能发送消息、加入实时会话，也不能浏览其他 RemoteLab 内容。";
    const items = [
      { label: "工具", value: tool },
      { label: timestampLabel, value: formatDate(snapshot.createdAt) },
      { label: "事件数", value: String(Array.isArray(snapshot.events) ? snapshot.events.length : 0) },
    ];

    document.title = `${name} · ${titleSuffix}`;
    snapshotTitle.textContent = name;
    if (heroBadge) heroBadge.textContent = badge;
    if (heroNote) heroNote.textContent = note;
    snapshotMeta.innerHTML = items
      .map((item) => `<div class="hero-meta-item"><strong>${esc(item.label)}:</strong> ${esc(item.value)}</div>`)
      .join("");
  }

  function renderSnapshot() {
    renderMeta();
    messagesInner.innerHTML = "";
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    if (events.length === 0) {
      messagesInner.innerHTML = '<div class="empty-state">这个快照还是空的。</div>';
      return;
    }
    for (const event of events) {
      renderEvent(event);
    }
    if (inThinkingBlock) finalizeThinkingBlock();
  }

  registerMarkdownExtensions();
  renderSnapshot();
})();
