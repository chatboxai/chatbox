# The .pen Format

- Source: https://docs.pencil.dev/for-developers/the-pen-format
- Fetched: 2026-04-02T23:18:43.741466+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# The .pen Format

Pencil documents are stored in .pen files. This documentation is for developers who would like to read or write .pen files.

The following sections provide a birds-eye view of the .pen format. For the authoritative, exhaustive reference of all the supported features, please consult the TypeScript schema at the end of this page.

This is a live documentation, and we reserve the right to introduce breaking changes in the .pen format.

## Overview

- .pen files contain a JSON structure, that describes an object tree , not unlike HTML or SVG.
- Each object in the document is a graphical entity on Pencil’s infinite two-dimensional canvas.
- The objects must have an id property that uniquely identifies them within the document, and a type field from one of the possible object types (like rectangle , frame , text , etc. – consult the TypeScript schema for the exhaustive list of supported types).

## Layout

- The top-level objects in a document are placed on an infinite two-dimensional canvas. They must have x and y properties that describe the location of their top-left corner.
- Objects nested under other objects are positioned relative to their parents’ top-left corner.
- A parent object can take over the sizing and positioning of its children using a flexbox-style layout system via properties like layout , justifyContent and alignItems .
- Child objects can choose to fill their parent, or use a fixed width and/or height .
- Parent objects can choose to fit the size of their children, or use a fixed width and/or height .

## Graphics

- The graphical appearance of objects is controlled by the fill , stroke and effect properties.
- A fill can be a solid color , a gradient (linear, radial or angular), an image or a mesh_gradient .
- An object can have multiple fills, which are painted on top of each other the same order they appear in the document.
- An object can have a single stroke, but the stroke can have multiple fills.
- An object can have multiple effects, which are applied in the same order they appear in the document.

## Components and Instances

A key difference between Pencil documents and HTML or SVG is that Pencil documents allow reusing existing chunks of the object tree at different places. This enables the building of reusable components, that can be used as concise building blocks for more complicated structures.

### Components

When an object is marked with the property reusable: true , it becomes a reusable component :

```text
{


  "id"
: 
"foo"
,


  "type"
: 
"rectangle"
,


  "reusable"
: 
true
, 
// <- this object is now a reusable component


  "x"
: 
0
, 
"y"
: 
0
, 
"width"
: 
100
, 
"height"
: 
100
,


  "fill"
: 
"#FF0000"


}
```

### Instances

The object type ref is used to create an instance of such components:

```text
{


  "id"
: 
"bar"
,


  "type"
: 
"ref"
,


  "ref"
: 
"foo"
, 
// <- this object is an instance of the component "foo"


  "x"
: 
120
, 
"y"
: 
0


}
```

Here foo is a 100x100 red ( #FF0000 ) square, and a reusable component. bar is an instance of foo , so it is also a 100x100 red square.

### Overrides

Instances can override properties from their component definition:

```text
{


  "id"
: 
"baz"
,


  "type"
: 
"ref"
,


  "ref"
: 
"foo"
,


  "x"
: 
240
, 
"y"
: 
0
,


  "fill"
: 
"#0000FF"


}
```

Even though baz is an instance of foo , it overrides the inherited fill property with a different one. So it’s going to be a 100x100 blue ( #0000FF ) square!

### Nesting

An instance replicates everything under the component root:

```text
{


  "id"
: 
"round-button"
,


  "type"
: 
"frame"
,


  "reusable"
: 
true
,


  "cornerRadius"
: 
9999
,


  "children"
: [


    {


      "id"
: 
"label"
,


      "type"
: 
"text"
,


      "content"
: 
"Submit"
,


      "fill"
: 
"#000000"


      ...


    }


  ]


}


 


{


  "id"
: 
"red-round-button"
,


  "type"
: 
"ref"
,


  "ref"
: 
"round-button"
,


  "fill"
: 
"#FF0000"


}
```

Here red-round-button will have an identical "Submit" label as round-button . But this label, too, can be customized using the descendants property:

```text
{


  "id"
: 
"red-round-button"
,


  "type"
: 
"ref"
,


  "ref"
: 
"round-button"
,


  "fill"
: 
"#FF0000"
,


  "descendants"
: {


    "label"
: { 
// <- "label" is the `id` of the object under "red-round-button" that we want to customize


      "text"
: 
"Cancel"
,


      "fill"
: 
"#FFFFFF"


    }


  }


}
```

Now the red button’s label will be white, and say "Cancel" .

Components can be built from instances of other components:

```text
{


  "id"
: 
"alert"
,


  "type"
: 
"frame"
,


  "reusable"
: 
true
,


  "children"
: [


    {


      "id"
: 
"message"
,


      "type"
: 
"text"
,


      "content"
: 
"This is an alert!"
,


      "fill"
: 
"#000000"


      ...


    },


    {


      "id"
: 
"ok-button"
,


      "type"
: 
"ref"
,


      "ref"
: 
"round-button"
,


      "descendants"
: {


        "label"
: {


          "text"
: 
"OK"


        }


      }


    },


    {


      "id"
: 
"cancel-button"
,


      "type"
: 
"ref"
,


      "ref"
: 
"round-button"
,


      "descendants"
: {


        "label"
: {


          "text"
: 
"Cancel"


        }


      }


    }


  ]


}
```

And children of nested instances can be customized by prefixing their IDs with the containing instance’s ID and a slash in the descendants map:

```text
{


  "id"
: 
"save-alert"
,


  "type"
: 
"ref"
,


  "ref"
: 
"alert"
,


  "descendants"
: {


    "message"
: {


      "content"
: 
"You have unsaved changes. Do you want to save them?"


    },


    "ok-button/label"
: { 
// <- we're customizing the "label" under "ok-button"


      "content"
: 
"Save"


    },


    "cancel-button/label"
: { 
// <- we're customizing the "label" under "cancel-button"


      "content"
: 
"Discard Changes"
,


      "fill"
: 
"#FF0000"


    }


  }


}
```

In addition to customization, an object inside an instance can be completely replaced with new object:

```text
{


  "id"
: 
"icon-button"
,


  "type"
: 
"ref"
,


  "ref"
: 
"round-button"
,


  "descendants"
: {


    "label"
: {


      "id"
: 
"icon"
,


      "type"
: 
"icon_font"
, 
// <- the presence of the `type` property indicates that this is an object replacement


      "iconFontFamily"
: 
"lucide"
,


      "icon"
: 
"check"


    }


  }


}
```

Alternatively to 1:1 replacement, an object can be kept as is, and we can replace only its children with new objects:

```text
{


  "id"
: 
"sidebar"


  "type"
:
 "frame"
,


  "reusable"
: 
true
,


  "children"
: [


    {


      "id"
: 
"header"
,


      "type"
: 
"frame"
,


      "fill"
: 
"#FF0000"


    },


    {


      "id"
: 
"content"
,


      "type"
: 
"frame"
,


      "fill"
: 
"#00FF00"


    },


    {


      "id"
: 
"footer"
,


      "type"
: 
"frame"
,


      "fill"
: 
"#0000FF"


    }


  ]


}


 


{


  "id"
: 
"menu-sidebar"


  "type"
:
 "ref"
,


  "ref"
: 
"sidebar"
,


  "descendants"
: {


    "content"
: {


      "children"
: [ 
// <- the children of "content" are replaced with some "round-button" instances


        {


          "id"
: 
"home-button"
,


          "type"
: 
"ref"
,


          "ref"
: 
"round-button"
,


          "descendants"
: {


            "label"
: {


              "text"
: 
"Home"


            }


          }


        },


        {


          "id"
: 
"settings-button"
,


          "type"
: 
"ref"
,


          "ref"
: 
"round-button"
,


          "descendants"
: {


            "label"
: {


              "text"
: 
"Settings"


            }


          }


        },


        {


          "id"
: 
"help-button"
,


          "type"
: 
"ref"
,


          "ref"
: 
"round-button"
,


          "descendants"
: {


            "label"
: {


              "text"
: 
"Help"


            }


          }


        }


      ]


    }


  }


}
```

This children replacement mechanism is ideal for container-style components, like panels, cards, windows, sidebars, etc.

### Slots

When a frame inside a component is intended to have its children replaced (e.g. the content holder frame inside a panel), it can be marked with the slot property:

```text
{


  "id"
: 
"sidebar"


  "type"
:
 "frame"
,


  "reusable"
: 
true
,


  "children"
: [


    {


      "id"
: 
"header"
,


      "type"
: 
"frame"
,


      "fill"
: 
"#FF0000"


    },


    {


      "id"
: 
"content"
,


      "type"
: 
"frame"
,


      "fill"
: 
"#00FF00"
,


      "slot"
: [ 
// <- "content" is marked as a slot, which is intended to be populated with "round-button" or "icon-button" instances


        "round-button"
,


        "icon-button"


      ]


    },


    {


      "id"
: 
"footer"
,


      "type"
: 
"frame"
,


      "fill"
: 
"#0000FF"


    }


  ]


}
```

Pencil displays such slots with a special effect, and lets users insert instances of the suggested components (i.e. round-button or icon-button above) with a single click.

## Variables and Themes

Pencil supports extracting commonly used colors and numeric values (padding, corner radius, opacity, etc.) into document-wide variables:

```text
{


  "variables"
: {


    "color.background"
: {


      "type"
: 
"color"
,


      "value"
: 
"#FFFFFF"


    },


    "color.text"
: {


      "type"
: 
"color"
,


      "value"
: 
"#333333"


    },


    "text.title"
: {


      "type"
: 
"number"
,


      "value"
: 
72


    }


  },


  "children"
: [


    {


      "id"
: 
"landing-page"
,


      "type"
: 
"frame"
,


      "fill"
: 
"$color.background"
,


      "children"
: [


        {


          "id"
: 
"welcome-label"
,


          "type"
: 
"text"
,


          "fill"
: 
"$color.text"
,


          "fontSize"
: 
"$text.title"
,


          "content"
: 
"Welcome!"


        }


      ]


    }


  ]


}
```

Pencil also implements a powerful theming system, whereby variables can dynamically change their values depending on the theme configuration of each object:

```text
{


  "variables"
: {


    "color.background"
: {


      "type"
: 
"color"
,


      "value"
: [ 
// <- when a variable has multiple values, the value that wins during evaluation is the _last_ one whose theme is satisfied


        { 
"value"
: 
"#FFFFFF"
, 
"theme"
: { 
"mode"
: 
"light"
 } },


        { 
"value"
: 
"#000000"
, 
"theme"
: { 
"mode"
: 
"dark"
 } }


      ]


    },


    "color.text"
: {


      "type"
: 
"color"
,


      "value"
: [


        { 
"value"
: 
"#333333"
, 
"theme"
: { 
"mode"
: 
"light"
 } },


        { 
"value"
: 
"#AAAAAA"
, 
"theme"
: { 
"mode"
: 
"dark"
 } }


      ]


    },


    "text.title"
: {


      "type"
: 
"number"
,


      "value"
: [


        { 
"value"
: 
72
, 
"theme"
: { 
"spacing"
: 
"regular"
 } },


        { 
"value"
: 
36
, 
"theme"
: { 
"spacing"
: 
"condensed"
 } }


      ]


    }


  },


  "themes"
: { 
// <- the default value of each theme axis is the first value, so the default theme is { "mode": "light", "spacing": "regular" }


    "mode"
: [
"light"
, 
"dark"
],


    "spacing"
: [
"regular"
, 
"condensed"
]


  },


  "children"
: [


    {


      "id"
: 
"landing-page-light"
,


      "type"
: 
"frame"
,


      "fill"
: 
"$color.background"
, 
// #FFFFFF


      "children"
: [


        {


          "id"
: 
"welcome-label"
,


          "type"
: 
"text"
,


          "fill"
: 
"$color.text"
, 
// #333333


          "fontSize"
: 
"$text.title"
, 
// 72


          "content"
: 
"Welcome!"


        }


      ]


    },


    {


      "id"
: 
"landing-page-dark"
,


      "type"
: 
"frame"
,


      "theme"
: { 
"mode"
: 
"dark"
 }, 
// <- everything under this frame is using "mode": "dark"


      "fill"
: 
"$color.background"
, 
// #000000


      "children"
: [


        {


          "id"
: 
"welcome-label"
,


          "type"
: 
"text"
,


          "fill"
: 
"$color.text"
, 
// #AAAAAA


          "fontSize"
: 
"$text.title"
, 
// 72


          "content"
: 
"Welcome!"


        }


      ]


    },


    {


      "id"
: 
"landing-page-dark-condensed"
,


      "type"
: 
"frame"
,


      "fill"
: 
"$color.background"
, 
// #000000


      "theme"
: { 
"mode"
: 
"dark"
, 
"spacing"
: 
"condensed"
 }, 
// <- everything under this frame is using { "mode": "dark", "spacing": "condensed" }


      "children"
: [


        {


          "id"
: 
"welcome-label"
,


          "type"
: 
"text"
,


          "fill"
: 
"$color.text"
, 
// #AAAAAA


          "fontSize"
: 
"$text.title"
, 
// 36


          "content"
: 
"Welcome!"


        }


      ]


    },


  ]


}
```

## TypeScript Schema

```text
/** Each key must be an existing theme axis, and each value must be one of the possible values for that axis. E.g. { 'device': 'phone' } */


export
 interface
 Theme
 {


  [
key
:
 string
]
:
 string
;


}


 


/** To bind a variable to a property, set the property to the dollar-prefixed name of the variable! */


export
 type
 Variable
 =
 string
;


 


export
 type
 NumberOrVariable
 =
 number
 |
 Variable
;


 


/** Colors can be 8-digit RGBA hex strings (e.g. #AABBCCDD), 6-digit RGB hex strings (e.g. #AABBCC) or 3-digit RGB hex strings (e.g. #ABC which means #AABBCC). */


export
 type
 Color
 =
 string
;


 


export
 type
 ColorOrVariable
 =
 Color
 |
 Variable
;


 


export
 type
 BooleanOrVariable
 =
 boolean
 |
 Variable
;


 


export
 type
 StringOrVariable
 =
 string
 |
 Variable
;


 


export
 interface
 Layout
 {


  /** Enable flex layout. None means all children are absolutely positioned and will not be affected by layout properties. Frames default to horizontal, groups default to none. */


  layout
?:
 "none"
 |
 "vertical"
 |
 "horizontal"
;


  /** The gap between children in the main axis direction. Defaults to 0. */


  gap
?:
 NumberOrVariable
;


  layoutIncludeStroke
?:
 boolean
;


  /** The Inside padding along the edge of the container */


  padding
?:


    |
 /** The inside padding to all sides */
 NumberOrVariable


    |
 /** The inside horizontal and vertical padding */
 [


        NumberOrVariable
,


        NumberOrVariable
,


      ]


    |
 /** Top, Right, Bottom, Left padding */
 [


        NumberOrVariable
,


        NumberOrVariable
,


        NumberOrVariable
,


        NumberOrVariable
,


      ];


  /** Control the justify alignment of the children along the main axis. Defaults to 'start'. */


  justifyContent
?:


    |
 "start"


    |
 "center"


    |
 "end"


    |
 "space_between"


    |
 "space_around"
;


  /** Control the alignment of children along the cross axis. Defaults to 'start'. */


  alignItems
?:
 "start"
 |
 "center"
 |
 "end"
;


}


 


/** SizingBehavior controls the dynamic layout size.


- fit_content: Use the combined size of all children for the container size. Fallback is used when there are no children.


- fill_container: Use the parent size for the container size. Fallback is used when the parent has no layout.


Optional number in parentheses (e.g., 'fit_content(100)') specifies the fallback size. */


export
 type
 SizingBehavior
 =
 string
;


 


/** Position is relative to the parent object's position. X increases rightwards, Y increases downwards.


IMPORTANT: x and y are IGNORED when parent uses flexbox layout. */


export
 interface
 Position
 {


  x
?:
 number
;


  y
?:
 number
;


}


 


export
 interface
 Size
 {


  width
?:
 NumberOrVariable
 |
 SizingBehavior
;


  height
?:
 NumberOrVariable
 |
 SizingBehavior
;


}


 


export
 interface
 CanHaveRotation
 {


  /** Rotation is represented in degrees, measured counter-clockwise. */


  rotation
?:
 NumberOrVariable
;


}


 


export
 type
 BlendMode
 =


  |
 "normal"


  |
 "darken"


  |
 "multiply"


  |
 "linearBurn"


  |
 "colorBurn"


  |
 "light"


  |
 "screen"


  |
 "linearDodge"


  |
 "colorDodge"


  |
 "overlay"


  |
 "softLight"


  |
 "hardLight"


  |
 "difference"


  |
 "exclusion"


  |
 "hue"


  |
 "saturation"


  |
 "color"


  |
 "luminosity"
;


 


export
 type
 Fill
 =


  |
 ColorOrVariable


  |
 {


      type
:
 "color"
;


      enabled
?:
 BooleanOrVariable
;


      blendMode
?:
 BlendMode
;


      color
:
 ColorOrVariable
;


    }


  |
 {


      type
:
 "gradient"
;


      enabled
?:
 BooleanOrVariable
;


      blendMode
?:
 BlendMode
;


      gradientType
?:
 "linear"
 |
 "radial"
 |
 "angular"
;


      opacity
?:
 NumberOrVariable
;


      /** Normalized to bounding box (default: 0.5,0.5). */


      center
?:
 Position
;


      /** Normalized to bounding box (default: 1,1). Linear: height sets gradient length, width is ignored. Radial/Angular: sets ellipse diameters. */


      size
?:
 { 
width
?:
 NumberOrVariable
; 
height
?:
 NumberOrVariable
 };


      /** Rotation in degrees, counterclockwise (0° up, 90° left, 180° down). */


      rotation
?:
 NumberOrVariable
;


      colors
?:
 { 
color
:
 ColorOrVariable
; 
position
:
 NumberOrVariable
 }[];


    }


  /** Image fill. Url needs to be a relative from the pen file, for example `../../file.png` or `./image.jpg` */


  |
 {


      type
:
 "image"
;


      enabled
?:
 BooleanOrVariable
;


      blendMode
?:
 BlendMode
;


      opacity
?:
 NumberOrVariable
;


      url
:
 string
;


      mode
?:
 "stretch"
 |
 "fill"
 |
 "fit"
;


    }


  /** Grid of colors with bezier-interpolated edges. Row-major order. Adjust the points and handles to create complex gradients. Keep the points on the edges at their default position. */


  |
 {


      type
:
 "mesh_gradient"
;


      enabled
?:
 BooleanOrVariable
;


      blendMode
?:
 BlendMode
;


      opacity
?:
 NumberOrVariable
;


      columns
?:
 number
;


      rows
?:
 number
;


      /** Color per vertex. */


      colors
?:
 ColorOrVariable
[];


      /** columns * rows points in [0,1] normalized coordinates. */


      points
?:
 (


        |
 /** Position with auto-generated handles. */
 [
number
, 
number
]


        |
 /** Position with optional bezier handles (relative offsets). Omitted handles are auto-generated. */
 {


            position
:
 [
number
, 
number
];


            leftHandle
?:
 [
number
, 
number
];


            rightHandle
?:
 [
number
, 
number
];


            topHandle
?:
 [
number
, 
number
];


            bottomHandle
?:
 [
number
, 
number
];


          }


      )[];


    };


 


export
 type
 Fills
 =
 Fill
 |
 Fill
[];


 


export
 interface
 Stroke
 {


  align
?:
 "inside"
 |
 "center"
 |
 "outside"
;


  thickness
?:


    |
 NumberOrVariable


    |
 {


        top
?:
 NumberOrVariable
;


        right
?:
 NumberOrVariable
;


        bottom
?:
 NumberOrVariable
;


        left
?:
 NumberOrVariable
;


      };


  join
?:
 "miter"
 |
 "bevel"
 |
 "round"
;


  miterAngle
?:
 NumberOrVariable
;


  cap
?:
 "none"
 |
 "round"
 |
 "square"
;


  dashPattern
?:
 number
[];


  fill
?:
 Fills
;


}


 


export
 type
 Effect
 =


  /** 'blur' type blurs the entire layer content */


  |
 { 
enabled
?:
 BooleanOrVariable
; 
type
:
 "blur"
; 
radius
?:
 NumberOrVariable
 }


  /** 'background_blur' type blurs the background content behind the layer */


  |
 {


      enabled
?:
 BooleanOrVariable
;


      type
:
 "background_blur"
;


      radius
?:
 NumberOrVariable
;


    }


  /** The drop shadow effect can be an inner or outer shadow, with adjustable offset, spread, blur, color and blend mode. */


  |
 {


      type
:
 "shadow"
;


      enabled
?:
 BooleanOrVariable
;


      shadowType
?:
 "inner"
 |
 "outer"
;


      offset
?:
 { 
x
:
 NumberOrVariable
; 
y
:
 NumberOrVariable
 };


      spread
?:
 NumberOrVariable
;


      blur
?:
 NumberOrVariable
;


      color
?:
 ColorOrVariable
;


      blendMode
?:
 BlendMode
;


    };


 


export
 type
 Effects
 =
 Effect
 |
 Effect
[];


 


export
 interface
 CanHaveGraphics
 {


  stroke
?:
 Stroke
;


  fill
?:
 Fills
;


  effect
?:
 Effects
;


}


 


export
 interface
 CanHaveEffects
 {


  effect
?:
 Effects
;


}


 


/** Entities have unique identifiers. */


export
 interface
 Entity
 extends
 Position
, 
CanHaveRotation
 {


  /** A unique string that MUST NOT contain slash (/) characters. If omitted, a unique ID will be generated automatically. */


  id
:
 string
;


  /** Optional name for the entity, used for display and identification purposes */


  name
?:
 string
;


  /** Optional context information about this object. */


  context
?:
 string
;


  /** Objects are not reusable by default. If an object is made reusable by setting this property to `true`, the object can be duplicated using `ref` objects. */


  reusable
?:
 boolean
;


  theme
?:
 Theme
;


  enabled
?:
 BooleanOrVariable
;


  opacity
?:
 NumberOrVariable
;


  flipX
?:
 BooleanOrVariable
;


  flipY
?:
 BooleanOrVariable
;


  /** layoutPosition controls how a node is positioned within its parent. */


  layoutPosition
?:
 "auto"
 |
 "absolute"
;


  metadata
?:
 { 
type
:
 string
; [
key
:
 string
]
:
 any
 };


}


 


export
 interface
 Rectangleish
 extends
 Entity
, 
Size
, 
CanHaveGraphics
 {


  cornerRadius
?:


    |
 NumberOrVariable


    |
 [
NumberOrVariable
, 
NumberOrVariable
, 
NumberOrVariable
, 
NumberOrVariable
];


}


 


/** A rectangle is defined by its position and size. The position corresponds to the top-left corner. */


export
 interface
 Rectangle
 extends
 Rectangleish
 {


  type
:
 "rectangle"
;


}


 


/** An ellipse is defined by its bounding rectangle's position and size. */


export
 interface
 Ellipse
 extends
 Entity
, 
Size
, 
CanHaveGraphics
 {


  type
:
 "ellipse"
;


  /** Inner-to-outer radius ratio for ring shapes. 0 = solid, 1 = fully hollow. Default: 0. */


  innerRadius
?:
 NumberOrVariable
;


  /** Arc start angle in degrees, counter-clockwise from the right. Default: 0. */


  startAngle
?:
 NumberOrVariable
;


  /** Arc length in degrees from startAngle. Positive = counter-clockwise, negative = clockwise. Range: -360 to 360. Default: 360 (full ellipse). */


  sweepAngle
?:
 NumberOrVariable
;


}


 


/** A line is defined by its bounding rectangle's position and size. */


export
 interface
 Line
 extends
 Entity
, 
Size
, 
CanHaveGraphics
 {


  type
:
 "line"
;


}


 


/** A regular polygon is defined by its bounding rectangle's position and size. */


export
 interface
 Polygon
 extends
 Entity
, 
Size
, 
CanHaveGraphics
 {


  type
:
 "polygon"
;


  polygonCount
?:
 NumberOrVariable
;


  cornerRadius
?:
 NumberOrVariable
;


}


 


export
 interface
 Path
 extends
 Entity
, 
Size
, 
CanHaveGraphics
 {


  /** fillRule is used to determine which parts of the path are considered inside the shape to be filled. Default is 'nonzero'. */


  fillRule
?:
 "nonzero"
 |
 "evenodd"
;


  /** SVG Path */


  geometry
?:
 string
;


  type
:
 "path"
;


}


 


export
 interface
 TextStyle
 {


  fontFamily
?:
 StringOrVariable
;


  fontSize
?:
 NumberOrVariable
;


  fontWeight
?:
 StringOrVariable
;


  letterSpacing
?:
 NumberOrVariable
;


  fontStyle
?:
 StringOrVariable
;


  underline
?:
 BooleanOrVariable
;


  /** A multiplier that gets applied to the font size to determine spacing between lines. If not specified, uses the font's built-in line height. */


  lineHeight
?:
 NumberOrVariable
;


  textAlign
?:
 "left"
 |
 "center"
 |
 "right"
 |
 "justify"
;


  textAlignVertical
?:
 "top"
 |
 "middle"
 |
 "bottom"
;


  strikethrough
?:
 BooleanOrVariable
;


  href
?:
 string
;


}


 


export
 type
 TextContent
 =
 StringOrVariable
 |
 TextStyle
[];


 


export
 interface
 Text
 extends
 Entity
, 
Size
, 
CanHaveGraphics
, 
TextStyle
 {


  type
:
 "text"
;


  content
?:
 TextContent
;


  /** textGrowth controls how the text box dimensions behave. It must be set before width or height can be used — without textGrowth, the width and height properties are ignored.


'auto': The text box automatically grows to fit the text content. Text does not wrap. Width and height adjust dynamically.


'fixed-width': The width is fixed and text wraps within it. The height grows automatically to fit the wrapped content.


'fixed-width-height': Both width and height are fixed. Text wraps and may be overflow if it exceeds the bounds.


IMPORTANT: Never set width or height without also setting textGrowth. If you want to control the size of a text box, you must set textGrowth first. */


  textGrowth
?:
 "auto"
 |
 "fixed-width"
 |
 "fixed-width-height"
;


}


 


export
 interface
 CanHaveChildren
 {


  children
?:
 Child
[];


}


 


/** A frame is a rectangle that can have children. */


export
 interface
 Frame
 extends
 Rectangleish
, 
CanHaveChildren
, 
Layout
 {


  type
:
 "frame"
;


  /** Visually clip content that overflows the frame bounds. Default is false. */


  clip
?:
 BooleanOrVariable
;


  placeholder
?:
 boolean
;


  /** The presence of this property indicates that this frame is a "slot" - which means that it is intended be customized with children in instances of the parent component. Each element of the array is an ID of a "recommended" reusable component, one which fits semantically as a child here (e.g. inside a menu bar, the content slot would recommend IDs of various menu item components). */


  slot
?:
 string
[];


}


 


export
 interface
 Group
 extends
 Entity
, 
CanHaveChildren
, 
CanHaveEffects
, 
Layout
 {


  type
:
 "group"
;


  width
?:
 SizingBehavior
;


  height
?:
 SizingBehavior
;


}


 


export
 interface
 Note
 extends
 Entity
, 
Size
, 
TextStyle
 {


  type
:
 "note"
;


  content
?:
 TextContent
;


}


 


export
 interface
 Prompt
 extends
 Entity
, 
Size
, 
TextStyle
 {


  type
:
 "prompt"
;


  content
?:
 TextContent
;


  model
?:
 StringOrVariable
;


}


 


export
 interface
 Context
 extends
 Entity
, 
Size
, 
TextStyle
 {


  type
:
 "context"
;


  content
?:
 TextContent
;


}


 


/** Icon from a font */


export
 interface
 IconFont
 extends
 Entity
, 
Size
, 
CanHaveEffects
 {


  type
:
 "icon_font"
;


  /** Name of the icon in the icon font */


  iconFontName
?:
 StringOrVariable
;


  /** Icon font to use. Valid fonts are 'lucide', 'feather', 'Material Symbols Outlined', 'Material Symbols Rounded', 'Material Symbols Sharp', 'phosphor' */


  iconFontFamily
?:
 StringOrVariable
;


  /** Variable font weight, only valid for icon fonts with variable weight. Values from 100 to 700. */


  weight
?:
 NumberOrVariable
;


  fill
?:
 Fills
;


}


 


/** References allow reusing other objects in different places. */


export
 interface
 Ref
 extends
 Entity
 {


  type
:
 "ref"
;


  /** The `ref` property must be another object's ID. */


  ref
:
 string
;


  /** This can be used to customize the properties of descendant objects except the `children` property. */


  descendants
?:
 {


    [


      key
: 
string
 /** Each key is an ID path pointing to a descendant object. */


    ]
:
 {} 
/** Descendant objects can be customized in two manners:


- Property overrides: only the customized properties are present with their new values. In this case, the `id`, `type` and `children` properties must not be specified!


- Object replacement: in this case, this object must be a completely new node tree, that will replace the original descendant of the referenced component. This is useful for adding custom content to instances of container-type components (cards, windows, panels, etc). */
;


  };


  [
key
:
 string
]
:
 any
;


}


 


export
 type
 Child
 =


  |
 Frame


  |
 Group


  |
 Rectangle


  |
 Ellipse


  |
 Line


  |
 Path


  |
 Polygon


  |
 Text


  |
 Note


  |
 Prompt


  |
 Context


  |
 IconFont


  |
 Ref
;


 


export
 type
 IdPath
 =
 string
;


 


export
 interface
 Document
 {


  version
:
 "2.9"
;


  themes
?:
 { [
key
:
 string
 /** RegEx: [^:]+ */
]
:
 string
[] };


  imports
?:
 {


    [


      key
: 
string


    ]
:
 string
 /** Each value is a path to an imported .pen file, from which variables and reusable components are made available in the current file. The key is a short alias for the imported file. */
;


  };


  variables
?:
 {


    [
key
:
 string
 /** RegEx: [^:]+ */
]
:


      |
 {


          type
:
 "boolean"
;


          value
:


            |
 BooleanOrVariable


            |
 { 
value
:
 BooleanOrVariable
; 
theme
?:
 Theme
 }[];


        }


      |
 {


          type
:
 "color"
;


          value
:
 ColorOrVariable
 |
 { 
value
:
 ColorOrVariable
; 
theme
?:
 Theme
 }[];


        }


      |
 {


          type
:
 "number"
;


          value
:


            |
 NumberOrVariable


            |
 { 
value
:
 NumberOrVariable
; 
theme
?:
 Theme
 }[];


        }


      |
 {


          type
:
 "string"
;


          value
:


            |
 StringOrVariable


            |
 { 
value
:
 StringOrVariable
; 
theme
?:
 Theme
 }[];


        };


  };


  children
:
 (


    |
 Frame


    |
 Group


    |
 Rectangle


    |
 Ellipse


    |
 Line


    |
 Polygon


    |
 Path


    |
 Text


    |
 Note


    |
 Context


    |
 Prompt


    |
 IconFont


    |
 Ref


  )[];


}
```
