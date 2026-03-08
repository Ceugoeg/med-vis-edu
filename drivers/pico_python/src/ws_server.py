#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import websockets
import threading
import logging

# 抑制 websockets 库过于繁琐的默认日志，保持终端清爽
logging.getLogger('websockets').setLevel(logging.WARNING)


class WebSocketBroadcaster:
    def __init__(self, host='0.0.0.0', port=8080):
        """
        轻量级 WebSocket 广播服务。
        负责将主线程中推理出的结构化运动学数据（JSON）高频下发给所有连接的前端引擎。
        """
        self.host = host
        self.port = port
        self.clients = set()

        # 为后台网络线程创建一个专属的异步事件循环
        self.loop = asyncio.new_event_loop()
        self.thread = None
        self.server = None

    async def _handler(self, websocket):
        """
        客户端连接处理协程。每当有前端浏览器连入时，会触发此回调。
        """
        # 将新客户端加入广播池
        self.clients.add(websocket)
        client_ip = websocket.remote_address[0]
        print(f"\n[WS] 渲染端已连接: {client_ip} | 当前连接数: {len(self.clients)}")

        try:
            # 保持连接活跃。当前设计为单向数据流 (Edge -> End)，
            # 因此这里只做挂起监听，忽略渲染端发来的任何消息。
            async for msg in websocket:
                pass
        except websockets.ConnectionClosed:
            pass
        finally:
            # 客户端断开（如刷新页面），将其移出广播池
            self.clients.remove(websocket)
            print(f"\n[WS] 渲染端已断开: {client_ip} | 当前连接数: {len(self.clients)}")

    def _start_server(self):
        """
        在后台守护线程中真正执行的方法：绑定事件循环并启动 WS 服务器。
        """
        asyncio.set_event_loop(self.loop)
        # 启动 WebSocket 服务
        start_server = websockets.serve(self._handler, self.host, self.port)
        self.server = self.loop.run_until_complete(start_server)
        print(f"[WS] WebSocket 广播服务已启动，监听 ws://{self.host}:{self.port}")

        # 开启事件循环，永久阻塞当前后台线程（直到主程序调用 stop）
        self.loop.run_forever()

    def start(self):
        """
        启动后台守护线程。主线程调用此方法后会立刻返回，继续执行 TFLite 推理。
        """
        self.thread = threading.Thread(target=self._start_server, daemon=True)
        self.thread.start()

    def broadcast(self, message: str):
        """
        线程安全的广播机制（极其关键）。
        由主线程中的 TFLite 推理循环高频调用，将 JSON 字符串跨线程推送给所有客户端。
        """
        if not self.clients:
            return

        async def _send_all():
            # 创建并发发送任务，防止某个网络极差的客户端阻塞了其他客户端的接收
            if self.clients:
                await asyncio.gather(
                    *[asyncio.create_task(client.send(message)) for client in self.clients],
                    return_exceptions=True
                )

        # 跨越线程边界：将异步发送任务强行塞入后台网络线程的事件循环中排队执行
        asyncio.run_coroutine_threadsafe(_send_all(), self.loop)

    def stop(self):
        """
        优雅的资源回收机制
        """
        if self.server:
            self.server.close()
            # 线程安全地停止异步循环
            self.loop.call_soon_threadsafe(self.loop.stop)
        if self.thread:
            self.thread.join(timeout=1.0)