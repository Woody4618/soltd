import { useEffect } from "react"
import { useRouter } from "next/router"

// The tower defense game now lives at the site root ("/"). This route is kept
// only to redirect any old bookmarks/links to the home page.
export default function TowerDefenseRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/")
  }, [router])
  return null
}
