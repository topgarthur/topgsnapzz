import numpy as np
from onnx import TensorProto, helper, numpy_helper, save

kernel = np.array(
    [
        [1, 4, 6, 4, 1],
        [4, 16, 24, 16, 4],
        [6, 24, 36, 24, 6],
        [4, 16, 24, 16, 4],
        [1, 4, 6, 4, 1],
    ],
    dtype=np.float32,
)
kernel /= kernel.sum()
weight = np.zeros((3, 3, 5, 5), dtype=np.float32)
for channel in range(3):
    weight[channel, channel] = kernel

initializers = [
    numpy_helper.from_array(weight, name="W"),
    numpy_helper.from_array(np.zeros((3,), dtype=np.float32), name="B"),
    numpy_helper.from_array(np.array([1], dtype=np.float32).reshape(1, 1, 1, 1), name="one"),
]

context = helper.make_tensor_value_info("context", TensorProto.FLOAT, [1, 3, 64, 64])
mask = helper.make_tensor_value_info("mask", TensorProto.FLOAT, [1, 1, 64, 64])
output = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, 64, 64])
nodes = [
    helper.make_node("Conv", ["context", "W", "B"], ["blurred"], kernel_shape=[5, 5], pads=[2, 2, 2, 2]),
    helper.make_node("Sub", ["one", "mask"], ["keep"]),
    helper.make_node("Mul", ["context", "keep"], ["known"]),
    helper.make_node("Mul", ["blurred", "mask"], ["filled"]),
    helper.make_node("Add", ["known", "filled"], ["output"]),
]
graph = helper.make_graph(nodes, "outpaint_prior", [context, mask], [output], initializers)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], ir_version=8)
save(model, "public/models/outpaint_prior.onnx")
print("wrote public/models/outpaint_prior.onnx")
