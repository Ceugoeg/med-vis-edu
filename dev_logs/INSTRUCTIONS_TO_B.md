**B 的具体操作步骤（Slicer + Blender 联动）：**

* **第一步：把 VTK 转成通用格式 (OBJ/STL)**
* **方案 A（推荐，用 3D Slicer）**：下载并打开压缩包里提到的 **3D Slicer** 软件。把 `brain-atlas.mrml` 拖进去，这时候能看到完整的脑子。点击左上角的 `Save`（保存），在弹出的保存列表里，把所有 3D Model 的格式从 `.vtk` 批量改成 `.obj`，导出到一个新文件夹里。
* **方案 B（用 MeshLab 或 ParaView）**：如果有这类科学可视化软件，可以直接把 `models` 文件夹里的所有 `.vtk` 批量转换成 `.obj`。


* **第二步：导入 Blender**
* 打开 Blender，把刚才导出的所有 `.obj` 文件一次性全部导入（或者用 Blender 的批量导入插件）。
* **注意**：导入后，Blender 会自动把文件名作为零件的节点名（比如 `Model_17_left_hippocampus`）。**千万不要动这些名字！**


* **第三步：批量减面（最重要的一步，拯救性能）**
* 全选所有脑部零件。
* 给其中一个零件添加 **Decimate（精简）** 修改器。
* 将 Ratio（比率）调低，比如调到 `0.1` 或者 `0.05`（保留 5%~10% 的面数，只要形状还在，稍微有一点点多边形棱角也没关系，我会在前端加法线平滑和发光特效）。
* 按 `Ctrl + L`（或者在菜单里选 Copy to Selected），把这个减面修改器**一键同步给所有选中的零件**。


* **第四步：一键导出 GLB**
* 全选所有减面后的零件。
* 点击 `File -> Export -> glTF 2.0 (.glb/.gltf)`。
* 勾选 `Include -> Selected Objects`。
* 导出为 `brain_optimized.glb` 发给我。
