### 0.3.1 (2015-07-26)


#### Bug Fixes

* **dependencies:** updated to new multer ([2d8eee08](https://github.com/voxpelli/node-micropub-express/commit/2d8eee08473ecb784510c9f4ddc49ce1605f371b))
* **main:**
  * move verification endpoint to top ([5ec0f65c](https://github.com/voxpelli/node-micropub-express/commit/5ec0f65cf479d668977997ea559639026e89b1ff))
  * do not enforce specific properties ([a2c72d5f](https://github.com/voxpelli/node-micropub-express/commit/a2c72d5f97c98ddb1925ca3c51ee91c134178807), closes [#1](https://github.com/voxpelli/node-micropub-express/issues/1))
  * move input validation to create route ([b2de551c](https://github.com/voxpelli/node-micropub-express/commit/b2de551c9d96297ae2a92d1d8b174150b2877d9d))
  * more debugging calls ([f2c11123](https://github.com/voxpelli/node-micropub-express/commit/f2c11123a8f72ab5458e3b7921896947728c434a))
  * added some debugging calls ([486ac189](https://github.com/voxpelli/node-micropub-express/commit/486ac189673c0b8f366be32313bf4ad621d2cef5))


#### Features

* **main:** add a /verify endpoint ([fb7044cb](https://github.com/voxpelli/node-micropub-express/commit/fb7044cb75bd681530fa0214949d0689cdbabe65))


## 0.3.0 (2015-07-17)


#### Features

* **main:**
  * consume and expose uploaded files ([310a379a](https://github.com/voxpelli/node-micropub-express/commit/310a379a0a2bc491b55f7e307ba6c8b8ba21c910))
  * should handle multipart payloads ([8a839f6b](https://github.com/voxpelli/node-micropub-express/commit/8a839f6b23f829a3913fec08e5220fd859ff8648))
  * should handle JSON payloads ([0be2b8ea](https://github.com/voxpelli/node-micropub-express/commit/0be2b8eab769c44e75c2465b6005c6407d775b60))


## 0.2.0 (2015-07-16)


#### Bug Fixes

* **main:** rename the "token" option to clarify ([3526fc4e](https://github.com/voxpelli/node-micropub-express/commit/3526fc4eef8db98813af90ba09738488e326b397))


#### Features

* **main:** provide a default user-agent + test it ([5dc3781d](https://github.com/voxpelli/node-micropub-express/commit/5dc3781df12e8b40b0779000bda1c4a3d60ac348))


#### Breaking Changes

* "token" option is now named "tokenReference".

 ([3526fc4e](https://github.com/voxpelli/node-micropub-express/commit/3526fc4eef8db98813af90ba09738488e326b397))


### 0.1.2 (2015-07-07)


### 0.1.1 (2015-07-07)


#### Features

* **main:** accept "like-of" documents ([4218217a](https://github.com/bloglovin/node-micropub-express/commit/4218217a9576c281d5eef3055dc9a85a9a16b9e0))

