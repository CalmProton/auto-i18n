# Creating Custom Components with shadcn-vue

## Example: Adding a Theme Toggle

Here's how to create a dark mode toggle button:

```vue
<!-- client/src/components/ThemeToggle.vue -->
<template>
  <Button variant="outline" size="icon" @click="toggleTheme">
    <svg
      v-if="isDark"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
    <svg
      v-else
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  </Button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Button } from '@/components/ui/button'

const isDark = ref(false)

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
})

const toggleTheme = () => {
  isDark.value = !isDark.value
  if (isDark.value) {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }
}
</script>
```

Then add it to your `App.vue`:

```vue
<template>
  <div class="min-h-screen bg-background">
    <div class="container mx-auto p-6 max-w-7xl">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold mb-2">🌍 Auto-i18n Client</h1>
          <p class="text-muted-foreground">Upload, translate, and sync your content</p>
        </div>
        <ThemeToggle />
      </div>
      
      <!-- Rest of your app -->
    </div>
  </div>
</template>

<script setup lang="ts">
import ThemeToggle from './components/ThemeToggle.vue'
// ... other imports
</script>
```

## Example: Adding a Dialog Modal

Install the dialog component:

```bash
bunx --bun shadcn-vue@latest add dialog
```

Create a confirmation dialog:

```vue
<!-- client/src/components/ConfirmDialog.vue -->
<template>
  <Dialog v-model:open="isOpen">
    <DialogTrigger as-child>
      <slot name="trigger">
        <Button variant="destructive">Delete</Button>
      </slot>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Are you sure?</DialogTitle>
        <DialogDescription>
          This action cannot be undone. Are you sure you want to continue?
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="isOpen = false">
          Cancel
        </Button>
        <Button variant="destructive" @click="handleConfirm">
          Confirm
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const isOpen = ref(false)

const emit = defineEmits<{
  confirm: []
}>()

const handleConfirm = () => {
  emit('confirm')
  isOpen.value = false
}
</script>
```

Usage:

```vue
<ConfirmDialog @confirm="deleteItem">
  <template #trigger>
    <Button variant="destructive">Delete All</Button>
  </template>
</ConfirmDialog>
```

## Example: Adding Toast Notifications

Install the toast component:

```bash
bunx --bun shadcn-vue@latest add toast
```

Set up toast in `App.vue`:

```vue
<template>
  <div>
    <!-- Your app content -->
    <Toaster />
  </div>
</template>

<script setup lang="ts">
import { Toaster } from '@/components/ui/toast'
</script>
```

Use in any component:

```vue
<script setup lang="ts">
import { useToast } from '@/components/ui/toast'

const { toast } = useToast()

const showSuccess = () => {
  toast({
    title: '✅ Success',
    description: 'Your files have been uploaded successfully.',
  })
}

const showError = () => {
  toast({
    title: '❌ Error',
    description: 'Something went wrong. Please try again.',
    variant: 'destructive',
  })
}
</script>
```

## Example: Custom Card Component

Create a reusable status card:

```vue
<!-- client/src/components/StatusCard.vue -->
<template>
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <CardTitle class="text-2xl">{{ title }}</CardTitle>
        <div
          class="h-3 w-3 rounded-full"
          :class="statusColor"
        />
      </div>
      <CardDescription>{{ description }}</CardDescription>
    </CardHeader>
    <CardContent>
      <slot />
    </CardContent>
    <CardFooter v-if="$slots.footer">
      <slot name="footer" />
    </CardFooter>
  </Card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  title: string
  description?: string
  status?: 'success' | 'warning' | 'error' | 'info'
}

const props = withDefaults(defineProps<Props>(), {
  status: 'info',
})

const statusColor = computed(() => {
  switch (props.status) {
    case 'success':
      return 'bg-green-500'
    case 'warning':
      return 'bg-yellow-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-blue-500'
  }
})
</script>
```

Usage:

```vue
<StatusCard 
  title="Translation Progress" 
  description="Current batch status"
  status="success"
>
  <p>5 of 10 languages completed</p>
  
  <template #footer>
    <Button>View Details</Button>
  </template>
</StatusCard>
```

## Useful Tailwind Utilities

### Responsive Design

```vue
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <!-- Cards will stack on mobile, 2 cols on tablet, 3 on desktop -->
</div>
```

### Hover & Focus States

```vue
<Button class="hover:scale-105 transition-transform">
  Hover Me
</Button>

<Input class="focus:ring-2 focus:ring-primary" />
```

### Spacing & Sizing

```vue
<div class="space-y-4">  <!-- Vertical spacing between children -->
  <Card />
  <Card />
  <Card />
</div>

<div class="w-full max-w-md mx-auto">  <!-- Centered, max width -->
  <form class="space-y-6">
    <!-- Form fields -->
  </form>
</div>
```

### Typography

```vue
<h1 class="text-4xl font-bold tracking-tight">Title</h1>
<p class="text-muted-foreground text-sm">Subtitle</p>
<code class="text-xs font-mono bg-muted px-1 py-0.5 rounded">code</code>
```

## Component Variants

shadcn-vue components come with built-in variants:

```vue
<!-- Button Variants -->
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

<!-- Button Sizes -->
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon">
  <Icon />
</Button>

<!-- Alert Variants -->
<Alert variant="default">Info</Alert>
<Alert variant="destructive">Error</Alert>
```

## Pro Tips

1. **Use `cn()` for conditional classes:**
   ```vue
   <script setup lang="ts">
   import { cn } from '@/lib/utils'
   
   const buttonClass = cn(
     'px-4 py-2',
     isActive && 'bg-primary',
     isDisabled && 'opacity-50 cursor-not-allowed'
   )
   </script>
   ```

2. **Compose components:**
   ```vue
   <Card>
     <CardHeader>
       <CardTitle>
         <div class="flex items-center gap-2">
           <Badge>New</Badge>
           Upload Files
         </div>
       </CardTitle>
     </CardHeader>
   </Card>
   ```

3. **Use slots for flexibility:**
   ```vue
   <Alert>
     <template #icon>
       <CustomIcon />
     </template>
     <AlertTitle>Custom Alert</AlertTitle>
     <AlertDescription>With custom content</AlertDescription>
   </Alert>
   ```

Happy coding! 🚀
