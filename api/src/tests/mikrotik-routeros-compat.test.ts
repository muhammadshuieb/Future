import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRouterOsApiOptions,
  parseHealthSensors,
  parsePingInternetReachable,
  parseRouterOsVersion,
  parseRosUptimeSeconds,
  isRosTruthy,
} from "../services/mikrotik-routeros-compat.js";

describe("mikrotik-routeros-compat", () => {
  it("enables TLS on API-SSL port 8729", () => {
    const o = buildRouterOsApiOptions("10.0.0.1", "u", "p", 8729, 5000);
    assert.ok(o.tls);
    assert.equal(o.port, 8729);
  });

  it("does not enable TLS on default port 8728", () => {
    const o = buildRouterOsApiOptions("10.0.0.1", "u", "p", 8728, 5000);
    assert.equal(o.tls, undefined);
  });

  it("parses uptime on ROS 6/7 style strings", () => {
    assert.equal(parseRosUptimeSeconds("1w2d3h4m5s"), 788645);
    assert.equal(parseRosUptimeSeconds("2h30m"), 9000);
  });

  it("detects routeros major version from resource", () => {
    assert.equal(parseRouterOsVersion({ version: "7.15.2 (stable)" }), "7");
    assert.equal(parseRouterOsVersion({ version: "6.49.10 (long-term)" }), "6");
  });

  it("parses health sensors by name", () => {
    const h = parseHealthSensors([
      { name: "cpu-temperature", value: "52" },
      { name: "voltage", value: "12.1" },
    ]);
    assert.equal(h.boardTemperature, 52);
    assert.equal(h.voltage, 12.1);
    assert.equal(h.voltageSupported, true);
  });

  it("parsePingInternetReachable — ROS 6 style replies", () => {
    assert.equal(
      parsePingInternetReachable([
        { seq: "0", host: "8.8.8.8", time: "9ms" },
        { seq: "1", host: "8.8.8.8", time: "10ms" },
      ]),
      true
    );
    assert.equal(
      parsePingInternetReachable([{ seq: "0", status: "timeout", host: "8.8.8.8" }]),
      false
    );
  });

  it("parsePingInternetReachable — ROS 7 summary row", () => {
    assert.equal(
      parsePingInternetReachable([{ sent: "2", received: "2", "packet-loss": "0" }]),
      true
    );
    assert.equal(
      parsePingInternetReachable([{ sent: "2", received: "0", "packet-loss": "100" }]),
      false
    );
  });

  it("isRosTruthy accepts yes/true", () => {
    assert.equal(isRosTruthy("yes"), true);
    assert.equal(isRosTruthy("true"), true);
    assert.equal(isRosTruthy("no"), false);
  });
});
