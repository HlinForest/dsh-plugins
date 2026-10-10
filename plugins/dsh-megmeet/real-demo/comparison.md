# 真实物料：同一 Prompt 对照

原始回答未改写，不能据单次运行声称准确率提升。v0.1.2首次真实测试发现单路/双路校验不足，原始文件保存在round1-v0.1.2。本轮v0.1.3加入输出路数条件，基础与完整需求结果见deterministic-results.json。

{
  "baseline": {
    "seconds": 42.42,
    "calls": 0,
    "steps": 1,
    "tokens": 26421
  },
  "plugin": {
    "seconds": 31.74,
    "calls": 11,
    "steps": 4,
    "tokens": 215409
  }
}

采购条款、派生条件、典型效率与保证值分开保存。详情见index.html、experiment.json、verification.json。
