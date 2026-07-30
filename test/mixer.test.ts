import { describe, expect, it } from "vitest";
import { autoDevHost, escapeRegExp, pickLanIPv4, renderName } from "../src/plugins/mixer";

// 测试数据只需 address / family / internal 三个字段，其余字段与断言无关
const iface = (address: string, internal = false, family: "IPv4" | "IPv6" = "IPv4") =>
  ({ address, internal, family }) as any;

describe("renderName", () => {
  it("去掉 .liquid 后缀", () => {
    expect(renderName("vite-mixer.liquid")).toBe("vite-mixer");
  });
  it("无后缀原样返回", () => {
    expect(renderName("vite-mixer")).toBe("vite-mixer");
  });
});

describe("escapeRegExp", () => {
  it("转义后按字面量匹配，元字符不生效", () => {
    const re = new RegExp(`^${escapeRegExp("vite.mixer")}$`);
    expect(re.test("vite.mixer")).toBe(true);
    expect(re.test("viteXmixer")).toBe(false);
  });
});

describe("autoDevHost", () => {
  it("未知 / 回环 → localhost", () => {
    expect(autoDevHost(undefined, {})).toBe("localhost");
    expect(autoDevHost("127.0.0.1", {})).toBe("localhost");
    expect(autoDevHost("::1", {})).toBe("localhost");
  });
  it("具体地址原样使用", () => {
    expect(autoDevHost("192.168.1.5", {})).toBe("192.168.1.5");
  });
  it("wildcard → 物理网卡 IPv4", () => {
    expect(autoDevHost("0.0.0.0", { en0: [iface("192.168.1.2")] })).toBe("192.168.1.2");
    expect(autoDevHost("::", { en0: [iface("192.168.1.2")] })).toBe("192.168.1.2");
  });
  it("wildcard 且无候选 → 回退 localhost", () => {
    expect(autoDevHost("0.0.0.0", {})).toBe("localhost");
  });
});

describe("pickLanIPv4", () => {
  it("排除隧道 / 虚拟网卡（VPN utun 不误选）", () => {
    expect(pickLanIPv4({ utun3: [iface("172.19.0.1")], en0: [iface("192.168.1.2")] })).toBe(
      "192.168.1.2",
    );
  });
  it("en0 优先于其他 en*，即使声明顺序靠后", () => {
    expect(pickLanIPv4({ en5: [iface("10.0.0.9")], en0: [iface("192.168.1.2")] })).toBe(
      "192.168.1.2",
    );
  });
  it("en* / eth* 优先于余下网卡", () => {
    expect(pickLanIPv4({ wlan0: [iface("10.0.0.1")], eth1: [iface("10.0.0.2")] })).toBe("10.0.0.2");
  });
  it("internal / IPv6 均不入候选", () => {
    expect(pickLanIPv4({ en0: [iface("127.0.0.1", true)] })).toBeUndefined();
    expect(pickLanIPv4({ en0: [iface("fe80::1", false, "IPv6")] })).toBeUndefined();
  });
  it("空表 → undefined", () => {
    expect(pickLanIPv4({})).toBeUndefined();
  });
});
